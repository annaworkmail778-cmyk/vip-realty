-- =============================================================================
-- Phase 4 — WhatsApp ingestion foundation
--
-- Additive and backward compatible. Inbound WhatsApp messages (Meta WhatsApp
-- Cloud API, delivered to n8n) are persisted through ONE database function so
-- idempotency, session association and the audit trail happen atomically in a
-- single transaction, whatever n8n retries.
--
--   whatsapp_messages  + sender_name, provider_contact_id, recipient_phone_number_id,
--                        message_id_source, delivery_count, last_delivered_at
--                      + processing_status 'unresolved_sender'
--   ingest_whatsapp_message(p_event jsonb, p_correlation_id text)  service_role only
--
-- Not in scope: AI extraction, property creation, media download, replies.
--
-- Rollback (only while no row uses 'unresolved_sender'):
--   drop function public.ingest_whatsapp_message(jsonb, text);
--   alter table public.whatsapp_messages drop constraint whatsapp_messages_processing_status_check;
--   alter table public.whatsapp_messages add constraint whatsapp_messages_processing_status_check
--     check (processing_status in ('received','buffered','processing','processed','failed','ignored'));
--   alter table public.whatsapp_messages drop column sender_name, drop column provider_contact_id,
--     drop column recipient_phone_number_id, drop column message_id_source,
--     drop column delivery_count, drop column last_delivered_at;
-- =============================================================================

-- ------------------------------------------------------- whatsapp_messages: columns
alter table public.whatsapp_messages
  add column sender_name               text,
  add column provider_contact_id       text,
  add column recipient_phone_number_id text,
  add column message_id_source         text not null default 'provider',
  add column delivery_count            integer not null default 1,
  add column last_delivered_at         timestamptz not null default now();

alter table public.whatsapp_messages
  add constraint whatsapp_messages_sender_name_check
    check (sender_name is null or (btrim(sender_name) <> '' and char_length(sender_name) <= 256)),
  add constraint whatsapp_messages_provider_contact_id_check
    check (provider_contact_id is null or provider_contact_id ~ '^[0-9]{5,20}$'),
  add constraint whatsapp_messages_recipient_phone_number_id_format
    check (recipient_phone_number_id is null or recipient_phone_number_id ~ '^[0-9]{5,30}$'),
  add constraint whatsapp_messages_message_id_source_check
    check (message_id_source in ('provider', 'derived')),
  add constraint whatsapp_messages_delivery_count_check check (delivery_count >= 1);

alter table public.whatsapp_messages drop constraint whatsapp_messages_processing_status_check;
alter table public.whatsapp_messages
  add constraint whatsapp_messages_processing_status_check
    check (processing_status in ('received', 'buffered', 'processing', 'processed', 'failed', 'ignored',
                                 'unresolved_sender'));

comment on column public.whatsapp_messages.sender_name is
  'WhatsApp profile name of the sender as reported by the provider (contacts[].profile.name). Untrusted display text.';
comment on column public.whatsapp_messages.provider_contact_id is
  'Provider contact id of the sender (WhatsApp wa_id). The conversation key is the E.164 form of it (sender_phone).';
comment on column public.whatsapp_messages.recipient_phone_number_id is
  'Business phone_number_id the message was sent to; routes the message to agencies.whatsapp_phone_number_id.';
comment on column public.whatsapp_messages.message_id_source is
  'provider = provider message id; derived = deterministic sha256 fallback used only when the provider omitted the id.';
comment on column public.whatsapp_messages.delivery_count is
  'How many times the provider delivered this message. Redeliveries increment this instead of creating rows.';
comment on column public.whatsapp_messages.processing_status is
  'received -> buffered (attached to an open session of a known agent) -> processing/processed/failed (later phases). '
  'unresolved_sender = sender is not an active agent of the agency; kept for traceability, never processed into listings.';

-- ----------------------------------------------------------- ingestion function
create function public.ingest_whatsapp_message(p_event jsonb, p_correlation_id text default null)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  c_media_types constant text[] := array['image', 'video', 'audio', 'document', 'sticker'];
  c_types       constant text[] := array['text', 'image', 'document', 'video', 'audio', 'sticker', 'location',
                                         'contacts', 'interactive', 'button', 'reaction', 'order', 'system',
                                         'unsupported'];
  v_correlation text := left(nullif(btrim(p_correlation_id), ''), 200);
  v_reason      text;
  v_raw         jsonb;
  v_recipient   text;
  v_wa_id       text;
  v_phone       text;
  v_type        text;
  v_ts_text     text;
  v_ts          timestamptz;
  v_at          timestamptz;
  v_pmid        text;
  v_pmid_source text := 'provider';
  v_body        text;
  v_name        text;
  v_context     text;
  v_media       jsonb;
  v_media_pid   text;
  v_mime        text;
  v_filename    text;
  v_agency_id   uuid;
  v_agent_id    uuid;
  v_agent_ok    boolean;
  v_message_id  uuid;
  v_session_id  uuid;
  v_session_new boolean := false;
  v_media_id    uuid;
  v_deliveries  integer;
  v_status      text;
  v_attempt     integer := 0;
begin
  -- ------------------------------------------------------------ validation
  if p_event is null or jsonb_typeof(p_event) <> 'object' then
    v_reason := 'event_not_object';
  end if;

  if v_reason is null and nullif(p_event ->> 'normalization_error', '') is not null then
    v_reason := case when p_event ->> 'normalization_error' ~ '^[a-z][a-z0-9_]{0,59}$'
                     then p_event ->> 'normalization_error' else 'normalization_failed' end;
  end if;

  if v_reason is null and coalesce(p_event ->> 'provider', '') <> 'whatsapp_cloud' then
    v_reason := 'unsupported_provider';
  end if;

  if v_reason is null then
    v_raw := p_event -> 'raw_payload';
    if v_raw is null or jsonb_typeof(v_raw) <> 'object' then
      v_reason := 'missing_raw_payload';
    elsif octet_length(v_raw::text) > 262144 then
      v_reason := 'payload_too_large';
    end if;
  end if;

  if v_reason is null then
    v_recipient := p_event ->> 'recipient_phone_number_id';
    if v_recipient is null or v_recipient !~ '^[0-9]{5,30}$' then
      v_reason := 'missing_recipient_phone_number_id';
    end if;
  end if;

  if v_reason is null then
    v_wa_id := p_event ->> 'sender_wa_id';
    if v_wa_id is null or v_wa_id !~ '^[1-9][0-9]{6,14}$' then
      v_reason := 'invalid_sender';
    else
      v_phone := '+' || v_wa_id;
    end if;
  end if;

  if v_reason is null then
    v_type := coalesce(p_event ->> 'message_type', '');
    if v_type <> all (c_types) then
      v_type := 'unsupported';
    end if;

    -- Provider timestamp: ISO 8601 or unix seconds. Implausible values are dropped, not trusted.
    v_ts_text := nullif(btrim(p_event ->> 'provider_timestamp'), '');
    if v_ts_text ~ '^[0-9]{9,11}$' then
      v_ts := to_timestamp(v_ts_text::bigint);
    elsif v_ts_text is not null then
      begin
        v_ts := v_ts_text::timestamptz;
      exception when others then
        v_ts := null;
      end;
    end if;
    if v_ts < timestamptz '2009-01-01' or v_ts > now() + interval '1 day' then
      v_ts := null;
    end if;

    -- Idempotency key: the provider message id; deterministic fallback only when it is absent.
    v_pmid := nullif(btrim(p_event ->> 'provider_message_id'), '');
    if v_pmid is not null and char_length(v_pmid) > 255 then
      v_reason := 'invalid_provider_message_id';
    elsif v_pmid is null then
      if v_ts is null or coalesce(jsonb_typeof(v_raw -> 'messages' -> 0), '') <> 'object' then
        v_reason := 'missing_message_id';
      else
        v_pmid := 'derived:' || encode(sha256(convert_to(
                    concat_ws('|', v_recipient, v_wa_id, extract(epoch from v_ts)::bigint, v_type,
                              (v_raw -> 'messages' -> 0)::text), 'UTF8')), 'hex');
        v_pmid_source := 'derived';
      end if;
    end if;
  end if;

  if v_reason is not null then
    insert into automation_events (agency_id, event_type, severity, source, correlation_id, details)
    values (null, 'whatsapp.message_rejected', 'warning', 'n8n', v_correlation,
            jsonb_strip_nulls(jsonb_build_object(
              'reason', v_reason,
              'provider_message_id', left(p_event ->> 'provider_message_id', 255),
              'raw_payload', case when octet_length(coalesce(v_raw, p_event)::text) <= 65536
                                  then coalesce(v_raw, p_event) end)));
    return jsonb_build_object('ok', false, 'outcome', 'rejected', 'reason', v_reason);
  end if;

  v_body     := nullif(btrim(left(p_event ->> 'text_body', 65536)), '');
  v_name     := nullif(btrim(left(regexp_replace(p_event ->> 'sender_name', '[[:cntrl:]]', ' ', 'g'), 256)), '');
  v_context  := nullif(btrim(p_event ->> 'context_provider_message_id'), '');
  if char_length(v_context) > 255 then v_context := null; end if;

  -- ------------------------------------------------------------- routing
  select a.id into v_agency_id from agencies a where a.whatsapp_phone_number_id = v_recipient;

  if v_agency_id is null then
    insert into automation_events (agency_id, event_type, severity, source, correlation_id, details)
    values (null, 'whatsapp.message_unroutable', 'warning', 'n8n', v_correlation,
            jsonb_build_object('reason', 'unknown_recipient_phone_number_id',
                               'recipient_phone_number_id', v_recipient,
                               'provider_message_id', v_pmid,
                               'message_type', v_type,
                               'raw_payload', case when octet_length(v_raw::text) <= 65536 then v_raw end));
    return jsonb_build_object('ok', false, 'outcome', 'unroutable', 'reason', 'unknown_recipient_phone_number_id');
  end if;

  begin
    -- ------------------------------------------------------ idempotent insert
    select g.id, g.is_active into v_agent_id, v_agent_ok
    from agents g where g.agency_id = v_agency_id and g.whatsapp_phone = v_phone;

    insert into whatsapp_messages (agency_id, agent_id, provider, provider_message_id, message_id_source,
                                   sender_phone, sender_name, provider_contact_id, recipient_phone_number_id,
                                   message_type, body, provider_timestamp, context_provider_message_id,
                                   raw_payload, processing_status)
    values (v_agency_id, case when v_agent_ok then v_agent_id end, 'whatsapp_cloud', v_pmid, v_pmid_source,
            v_phone, v_name, v_wa_id, v_recipient,
            v_type, v_body, v_ts, v_context,
            v_raw, 'received')
    on conflict (provider, provider_message_id) do nothing
    returning id into v_message_id;

    if v_message_id is null then
      update whatsapp_messages m
         set delivery_count = m.delivery_count + 1, last_delivered_at = now()
       where m.provider = 'whatsapp_cloud' and m.provider_message_id = v_pmid
      returning m.id, m.session_id, m.delivery_count, m.processing_status
        into v_message_id, v_session_id, v_deliveries, v_status;

      insert into automation_events (agency_id, event_type, severity, source, session_id, message_id,
                                     correlation_id, details)
      values (v_agency_id, 'whatsapp.message_duplicate', 'info', 'n8n', v_session_id, v_message_id,
              v_correlation, jsonb_build_object('provider_message_id', v_pmid, 'delivery_count', v_deliveries));

      return jsonb_build_object('ok', true, 'outcome', 'duplicate', 'message_id', v_message_id,
                                'session_id', v_session_id, 'processing_status', v_status,
                                'delivery_count', v_deliveries);
    end if;

    -- ------------------------------------------------------ media metadata only
    if v_type = any (c_media_types) then
      v_media := p_event -> 'media';
      v_media_pid := nullif(btrim(v_media ->> 'provider_media_id'), '');
      if v_media_pid is not null and char_length(v_media_pid) <= 255 then
        v_mime := nullif(btrim(v_media ->> 'mime_type'), '');
        if v_mime !~* '^[a-z0-9.+-]+/[a-z0-9.+-]+(\s*;.*)?$' or char_length(v_mime) > 255 then
          v_mime := null;
        end if;
        v_filename := nullif(btrim(left(regexp_replace(v_media ->> 'filename', '[[:cntrl:]/\\]', '_', 'g'), 255)), '');

        insert into whatsapp_media (agency_id, message_id, provider, provider_media_id, mime_type, filename)
        values (v_agency_id, v_message_id, 'whatsapp_cloud', v_media_pid, v_mime, v_filename)
        on conflict (provider, provider_media_id) do nothing
        returning id into v_media_id;

        if v_media_id is null then
          select wm.id into v_media_id from whatsapp_media wm
           where wm.provider = 'whatsapp_cloud' and wm.provider_media_id = v_media_pid;
        end if;
      end if;
    end if;

    -- ------------------------------------------------------ session / sender
    if v_agent_ok then
      v_at := least(coalesce(v_ts, now()), now());
      loop
        v_attempt := v_attempt + 1;
        insert into submission_sessions (agency_id, agent_id, channel, channel_conversation_key,
                                         started_at, last_message_at)
        values (v_agency_id, v_agent_id, 'whatsapp', v_phone, v_at, v_at)
        on conflict (agency_id, channel, channel_conversation_key) where status = 'open' do nothing
        returning id into v_session_id;

        if v_session_id is not null then
          v_session_new := true;
          exit;
        end if;

        update submission_sessions s
           set last_message_at = greatest(s.last_message_at, v_at),
               started_at      = least(s.started_at, v_at)
         where s.agency_id = v_agency_id and s.channel = 'whatsapp'
           and s.channel_conversation_key = v_phone and s.status = 'open'
        returning s.id into v_session_id;

        exit when v_session_id is not null or v_attempt >= 3;
      end loop;

      if v_session_id is null then
        raise exception 'could not open or reuse a submission session' using errcode = '40001';
      end if;

      update whatsapp_messages set session_id = v_session_id, processing_status = 'buffered'
       where id = v_message_id;
      v_status := 'buffered';

      if v_session_new then
        insert into automation_events (agency_id, event_type, severity, source, session_id, message_id,
                                       correlation_id, details)
        values (v_agency_id, 'session.opened', 'info', 'n8n', v_session_id, v_message_id, v_correlation,
                jsonb_build_object('channel', 'whatsapp', 'agent_id', v_agent_id));
      end if;

      insert into automation_events (agency_id, event_type, severity, source, session_id, message_id,
                                     correlation_id, details)
      values (v_agency_id, 'whatsapp.message_received', 'info', 'n8n', v_session_id, v_message_id, v_correlation,
              jsonb_strip_nulls(jsonb_build_object(
                'provider_message_id', v_pmid, 'message_id_source', v_pmid_source, 'message_type', v_type,
                'sender', 'agent', 'session_created', v_session_new, 'media_id', v_media_id,
                'media_missing', case when v_type = any (c_media_types) and v_media_id is null then true end)));
    else
      update whatsapp_messages set processing_status = 'unresolved_sender' where id = v_message_id;
      v_status := 'unresolved_sender';

      insert into automation_events (agency_id, event_type, severity, source, message_id, correlation_id, details)
      values (v_agency_id, 'whatsapp.sender_unresolved', 'warning', 'n8n', v_message_id, v_correlation,
              jsonb_strip_nulls(jsonb_build_object(
                'provider_message_id', v_pmid, 'message_id_source', v_pmid_source, 'message_type', v_type,
                'reason', case when v_agent_id is null then 'unknown_sender' else 'agent_inactive' end,
                'media_id', v_media_id)));
    end if;

  exception
    -- Data that violates the schema is permanent: record it instead of letting the caller retry forever.
    when check_violation or not_null_violation or foreign_key_violation or invalid_text_representation
      or string_data_right_truncation or numeric_value_out_of_range or datetime_field_overflow
      or invalid_datetime_format or character_not_in_repertoire or untranslatable_character then
      insert into automation_events (agency_id, event_type, severity, source, correlation_id, details)
      values (v_agency_id, 'whatsapp.message_rejected', 'error', 'n8n', v_correlation,
              jsonb_build_object('reason', 'schema_violation', 'sqlstate', sqlstate,
                                 'provider_message_id', v_pmid,
                                 'raw_payload', case when octet_length(v_raw::text) <= 65536 then v_raw end));
      return jsonb_build_object('ok', false, 'outcome', 'rejected', 'reason', 'schema_violation');
  end;

  return jsonb_strip_nulls(jsonb_build_object(
    'ok', true, 'outcome', 'stored', 'message_id', v_message_id, 'session_id', v_session_id,
    'session_created', v_session_new, 'processing_status', v_status, 'media_id', v_media_id,
    'message_id_source', v_pmid_source));
end;
$$;

comment on function public.ingest_whatsapp_message(jsonb, text) is
  'Persists one normalized inbound WhatsApp message atomically: idempotent on (provider, provider_message_id), '
  'routes by recipient phone_number_id, resolves the sender to an active agent, reuses/opens the conversation''s '
  'open submission session, stores media metadata and records automation_events. Permanent problems return '
  'outcome rejected/unroutable (recorded, never retried); transient failures raise so the caller retries. '
  'Callable by service_role only (n8n).';

revoke execute on function public.ingest_whatsapp_message(jsonb, text) from public, anon, authenticated;
grant execute on function public.ingest_whatsapp_message(jsonb, text) to service_role;
