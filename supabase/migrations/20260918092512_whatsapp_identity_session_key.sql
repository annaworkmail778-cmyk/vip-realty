-- =============================================================================
-- Phase 6.5 (follow-up) — stable session key per resolved agent
--
-- 20260918091820 keyed a direct conversation by the identifiers present in each payload (BSUID if present, else phone).
-- During Meta's BSUID rollout one agent can send a phone-only payload followed by a BSUID + phone payload; that would
-- have split one submission into two sessions. For a RESOLVED agent the session key is now the agent's registered
-- identity:  wa:<phone_number_id>:direct:<agents.whatsapp_user_id, else agents.whatsapp_phone>.
-- Unresolved senders keep the payload-derived key (they never get a session). Session lookups are additionally scoped
-- to the resolved agent, so an open session can never receive another agent's messages. Nothing else changes.
-- Rollback: re-run the ingest_whatsapp_message definition from 20260918091820.
-- =============================================================================

comment on column public.whatsapp_messages.conversation_id is
  'Canonical conversation identity: wa:<phone_number_id>:direct:<id> or wa:<phone_number_id>:group:<group_id>. For a '
  'resolved agent <id> is the agent''s registered BSUID (else its registered +phone); for an unresolved sender the '
  'payload''s BSUID (else +phone). Used as the submission session key. Never derived from display names.';
comment on column public.submission_sessions.channel_conversation_key is
  'Canonical conversation identity (whatsapp_messages.conversation_id): wa:<phone_number_id>:direct:<agent BSUID or '
  'agent +phone>. At most one open session per key; each session belongs to exactly one agent.';

-- ----------------------------------------------------- ingestion (replaced)
create or replace function public.ingest_whatsapp_message(p_event jsonb, p_correlation_id text default null)
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
  v_cfg         jsonb;
  v_quiet       interval;
  v_settle      interval;
  v_cap         interval;
  v_command     text;
  v_target      submission_sessions%rowtype;
  v_is_media    boolean;
  v_late_media  boolean := false;
  v_capped_id   uuid;
  v_count       integer;
  v_user_id     text;
  v_phone_digits text;
  v_sender_key  text;
  v_derive_key  text;
  v_group_id    text;
  v_conv_type   text;
  v_conv_id     text;
  v_agent_agency uuid;
  v_agent_user  text;
  v_resolved_by text;
  v_unresolved  text;
  v_agent_phone text;
  v_displaced   uuid;
begin
  -- ------------------------------------------------------------ validation (Phase 4, unchanged)
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
    -- Sender identity (Cloud API model): the business-scoped user id (BSUID, "CC.<alnum>") is preferred; the phone
    -- number is optional and may be omitted by Meta. Accepts the Phase 6.5 normalizer fields (sender_user_id,
    -- sender_phone) and the Phase 4 field sender_wa_id, which may hold either a phone number or a BSUID.
    v_user_id      := nullif(btrim(coalesce(p_event ->> 'sender_user_id', '')), '');
    v_phone_digits := nullif(regexp_replace(btrim(coalesce(p_event ->> 'sender_phone', '')), '^\+', ''), '');
    v_wa_id        := nullif(btrim(coalesce(p_event ->> 'sender_wa_id', '')), '');
    if v_wa_id ~ '^[1-9][0-9]{6,14}$' then
      v_phone_digits := coalesce(v_phone_digits, v_wa_id);
    elsif v_wa_id ~ '^[A-Z]{2}\.[A-Za-z0-9]{1,128}$' then
      v_user_id := coalesce(v_user_id, v_wa_id);
    elsif v_wa_id is not null then
      v_reason := 'invalid_sender';
    end if;
    if v_user_id is not null and v_user_id !~ '^[A-Z]{2}\.[A-Za-z0-9]{1,128}$' then
      v_reason := 'invalid_sender';
    end if;
    if v_phone_digits is not null and v_phone_digits !~ '^[1-9][0-9]{6,14}$' then
      v_reason := 'invalid_sender';
    end if;
    if v_user_id is null and v_phone_digits is null then
      v_reason := 'invalid_sender';
    end if;
    if v_reason is null then
      v_phone      := case when v_phone_digits is not null then '+' || v_phone_digits end;
      v_sender_key := coalesce(v_user_id, v_phone);
      -- fallback message id component: unchanged for phone-only payloads (Phase 4 compatibility)
      v_derive_key := coalesce(v_user_id, v_phone_digits);
    end if;
  end if;

  if v_reason is null then
    -- Conversation identity. Group messages are representable but not processed (no group ingestion yet).
    v_group_id := nullif(btrim(coalesce(p_event ->> 'group_id', '')), '');
    if v_group_id is not null and v_group_id !~ '^[A-Za-z0-9@._:-]{1,128}$' then
      v_reason := 'invalid_group_id';
    else
      v_conv_type := case when v_group_id is null then 'direct' else 'group' end;
      v_conv_id   := 'wa:' || v_recipient || case when v_group_id is null then ':direct:' || v_sender_key
                                                  else ':group:' || v_group_id end;
    end if;
  end if;

  if v_reason is null then
    v_type := coalesce(p_event ->> 'message_type', '');
    if v_type <> all (c_types) then
      v_type := 'unsupported';
    end if;

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

    v_pmid := nullif(btrim(p_event ->> 'provider_message_id'), '');
    if v_pmid is not null and char_length(v_pmid) > 255 then
      v_reason := 'invalid_provider_message_id';
    elsif v_pmid is null then
      if v_ts is null or coalesce(jsonb_typeof(v_raw -> 'messages' -> 0), '') <> 'object' then
        v_reason := 'missing_message_id';
      else
        v_pmid := 'derived:' || encode(sha256(convert_to(
                    concat_ws('|', v_recipient, v_derive_key, extract(epoch from v_ts)::bigint, v_type,
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
  v_is_media := v_type = any (c_media_types);

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
    -- ---------------------------------------------------- agent resolution (deterministic)
    -- 1. business-scoped user id (unique across agents); 2. phone within the agency that owns the business number,
    -- only if that agent is not registered under a DIFFERENT business-scoped id. Never display names, AI output or
    -- message text. Agents are never created or modified here.
    if v_user_id is not null then
      select g.id, g.is_active, g.agency_id, g.whatsapp_user_id, g.whatsapp_phone
        into v_agent_id, v_agent_ok, v_agent_agency, v_agent_user, v_agent_phone
        from agents g where g.whatsapp_user_id = v_user_id;
      if v_agent_id is not null then
        v_resolved_by := 'user_id';
      end if;
    end if;
    if v_resolved_by is null and v_phone is not null then
      select g.id, g.is_active, g.agency_id, g.whatsapp_user_id, g.whatsapp_phone
        into v_agent_id, v_agent_ok, v_agent_agency, v_agent_user, v_agent_phone
        from agents g where g.agency_id = v_agency_id and g.whatsapp_phone = v_phone;
      if v_agent_id is not null then
        if v_user_id is not null and v_agent_user is not null and v_agent_user <> v_user_id then
          v_unresolved := 'identity_conflict';
        else
          v_resolved_by := 'phone';
        end if;
      end if;
    end if;

    v_unresolved := case
      when v_unresolved is not null then v_unresolved
      when v_resolved_by is null then 'unknown_sender'
      when not v_agent_ok then 'agent_inactive'
      when v_agent_agency is distinct from v_agency_id then 'agency_mismatch'
    end;
    v_agent_ok := v_unresolved is null;
    if not v_agent_ok then
      v_agent_id := case when v_resolved_by is not null then v_agent_id end;
    end if;

    -- Session key of a resolved agent: the agent's REGISTERED identity (BSUID first, then phone), not the identifiers of
    -- this particular payload. Payload variants during Meta's BSUID rollout (phone only / BSUID + phone / BSUID only)
    -- therefore never split one submission into several sessions, and two agents never share a key.
    if v_agent_ok and v_conv_type = 'direct' then
      v_conv_id := 'wa:' || v_recipient || ':direct:' || coalesce(v_agent_user, v_agent_phone);
    end if;

    -- Commands exist only for resolved agents' plain text messages in direct conversations.
    if v_agent_ok and v_type = 'text' and v_conv_type = 'direct' then
      v_command := whatsapp_command(v_body);
    end if;

    -- ------------------------------------------------------ idempotent insert
    insert into whatsapp_messages (agency_id, agent_id, provider, provider_message_id, message_id_source,
                                   sender_phone, sender_name, provider_contact_id, recipient_phone_number_id,
                                   message_type, body, provider_timestamp, context_provider_message_id,
                                   raw_payload, processing_status, command, sender_user_id, conversation_type,
                                   conversation_id, group_id)
    values (v_agency_id, case when v_agent_ok then v_agent_id end, 'whatsapp_cloud', v_pmid, v_pmid_source,
            v_phone, v_name, v_wa_id, v_recipient,
            v_type, v_body, v_ts, v_context,
            v_raw, 'received', v_command, v_user_id, v_conv_type,
            v_conv_id, v_group_id)
    on conflict (provider, provider_message_id) do nothing
    returning id into v_message_id;

    if v_message_id is null then
      -- Redelivery: count it, never re-run session logic or commands.
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
    if v_is_media then
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

    if v_conv_type = 'group' then
      -- ---------------------------------------------------- group readiness only: stored, never processed
      update whatsapp_messages set processing_status = 'ignored' where id = v_message_id;
      insert into automation_events (agency_id, event_type, severity, source, message_id, correlation_id, details)
      values (v_agency_id, 'whatsapp.group_message_ignored', 'warning', 'n8n', v_message_id, v_correlation,
              jsonb_build_object('provider_message_id', v_pmid, 'reason', 'group_ingestion_not_enabled'));
      return jsonb_strip_nulls(jsonb_build_object(
        'ok', true, 'outcome', 'stored', 'message_id', v_message_id, 'processing_status', 'ignored',
        'conversation_type', v_conv_type, 'media_id', v_media_id, 'message_id_source', v_pmid_source));
    end if;

    if not coalesce(v_agent_ok, false) then
      -- ---------------------------------------------------- unresolved sender: stored, never processed
      update whatsapp_messages set processing_status = 'unresolved_sender' where id = v_message_id;
      v_status := 'unresolved_sender';

      insert into automation_events (agency_id, event_type, severity, source, message_id, correlation_id, details)
      values (v_agency_id, 'whatsapp.sender_unresolved', 'warning', 'n8n', v_message_id, v_correlation,
              jsonb_strip_nulls(jsonb_build_object(
                'provider_message_id', v_pmid, 'message_id_source', v_pmid_source, 'message_type', v_type,
                'reason', v_unresolved, 'identified_by', case when v_user_id is not null and v_phone is not null then 'user_id_and_phone'
                                                              when v_user_id is not null then 'user_id' else 'phone' end,
                'media_id', v_media_id)));

      return jsonb_strip_nulls(jsonb_build_object(
        'ok', true, 'outcome', 'stored', 'message_id', v_message_id, 'session_created', false,
        'processing_status', v_status, 'media_id', v_media_id, 'message_id_source', v_pmid_source,
        'reason', v_unresolved));
    end if;

    v_cfg    := submission_buffer_config(v_agency_id);
    v_quiet  := make_interval(secs => (v_cfg ->> 'quiet_period_seconds')::int);
    v_settle := make_interval(secs => (v_cfg ->> 'media_settle_seconds')::int);
    v_cap    := make_interval(secs => (v_cfg ->> 'max_session_seconds')::int);
    v_at     := least(coalesce(v_ts, now()), now());

    if v_command is not null then
      -- ---------------------------------------------------- commands
      select * into v_target from submission_sessions s
       where s.agency_id = v_agency_id and s.channel = 'whatsapp'
         and s.channel_conversation_key = v_conv_id and s.agent_id = v_agent_id and s.status = 'open'
       for update;

      if v_target.id is null and v_command = 'cancel' then
        -- A submission that is ready but not yet claimed can still be cancelled.
        select * into v_target from submission_sessions s
         where s.agency_id = v_agency_id and s.channel = 'whatsapp'
           and s.channel_conversation_key = v_conv_id and s.agent_id = v_agent_id and s.status = 'ready'
         order by s.created_at desc
         limit 1
         for update;
      end if;

      if v_target.id is null then
        update whatsapp_messages set processing_status = 'ignored' where id = v_message_id;
        v_status := 'ignored';
        insert into automation_events (agency_id, event_type, severity, source, message_id, correlation_id, details)
        values (v_agency_id, 'whatsapp.command_ignored', 'info', 'n8n', v_message_id, v_correlation,
                jsonb_build_object('command', v_command, 'reason', 'no_active_session', 'provider_message_id', v_pmid));
      elsif v_command = 'finish' then
        update submission_sessions s
           set status          = 'ready',
               close_reason    = 'done_command',
               last_message_at = greatest(s.last_message_at, v_at),
               -- ready now; claimable after the media settle period so photos sent just before
               -- "done" but delivered just after it still join this submission
               process_after   = now() + v_settle
         where s.id = v_target.id;
        update whatsapp_messages set session_id = v_target.id, processing_status = 'processed' where id = v_message_id;
        v_session_id := v_target.id;
        v_status := 'processed';
        insert into automation_events (agency_id, event_type, severity, source, session_id, message_id, correlation_id, details)
        values (v_agency_id, 'session.ready', 'info', 'n8n', v_target.id, v_message_id, v_correlation,
                jsonb_build_object('reason', 'done_command', 'command', 'finish'));
      else
        update submission_sessions s
           set status = 'cancelled', close_reason = 'cancel_command', closed_at = now(),
               last_message_at = greatest(s.last_message_at, v_at)
         where s.id = v_target.id;
        update whatsapp_messages set processing_status = 'ignored'
         where session_id = v_target.id and processing_status = 'buffered';
        get diagnostics v_count = row_count;
        update whatsapp_messages set session_id = v_target.id, processing_status = 'processed' where id = v_message_id;
        v_session_id := v_target.id;
        v_status := 'processed';
        insert into automation_events (agency_id, event_type, severity, source, session_id, message_id, correlation_id, details)
        values (v_agency_id, 'session.cancelled', 'info', 'n8n', v_target.id, v_message_id, v_correlation,
                jsonb_build_object('reason', 'cancel_command', 'previous_status', v_target.status,
                                   'cancelled_message_count', v_count));
      end if;

      return jsonb_strip_nulls(jsonb_build_object(
        'ok', true, 'outcome', 'stored', 'message_id', v_message_id, 'session_id', v_session_id,
        'session_created', false, 'processing_status', v_status, 'command', v_command,
        'message_id_source', v_pmid_source));
    end if;

    -- ------------------------------------------------------ content message: buffer into a session
    loop
      v_attempt := v_attempt + 1;
      v_target := null;

      select * into v_target from submission_sessions s
       where s.agency_id = v_agency_id and s.channel = 'whatsapp'
         and s.channel_conversation_key = v_conv_id and s.agent_id = v_agent_id and s.status = 'open'
       for update;

      -- Hard cap: an open session older than the cap stops accepting messages.
      if v_target.id is not null and v_target.created_at + v_cap <= now() then
        update submission_sessions set status = 'ready', close_reason = 'max_duration', process_after = now()
         where id = v_target.id;
        insert into automation_events (agency_id, event_type, severity, source, session_id, message_id, correlation_id, details)
        values (v_agency_id, 'session.ready', 'info', 'n8n', v_target.id, v_message_id, v_correlation,
                jsonb_build_object('reason', 'max_duration', 'detected_by', 'ingestion'));
        v_capped_id := v_target.id;
        v_target := null;
      end if;

      -- Late media: photos uploaded before "done" may be delivered just after it.
      if v_target.id is null and v_is_media then
        select * into v_target from submission_sessions s
         where s.agency_id = v_agency_id and s.channel = 'whatsapp'
           and s.channel_conversation_key = v_conv_id and s.agent_id = v_agent_id and s.status = 'ready'
           and s.close_reason = 'done_command' and s.process_after > now()
           and s.created_at + v_cap > now()
         order by s.created_at desc
         limit 1
         for update;

        if v_target.id is not null then
          update submission_sessions s
             set process_after   = greatest(s.process_after, now() + v_settle),
                 last_message_at = greatest(s.last_message_at, v_at),
                 started_at      = least(s.started_at, v_at)
           where s.id = v_target.id;
          v_session_id := v_target.id;
          v_late_media := true;
          exit;
        end if;
      end if;

      if v_target.id is not null then
        update submission_sessions s
           set last_message_at = greatest(s.last_message_at, v_at),
               started_at      = least(s.started_at, v_at),
               process_after   = least(s.created_at + v_cap,
                                       greatest(coalesce(s.process_after, '-infinity'::timestamptz),
                                                now() + v_quiet,
                                                case when v_is_media then now() + v_settle end))
         where s.id = v_target.id;
        v_session_id := v_target.id;
        exit;
      end if;

      insert into submission_sessions (agency_id, agent_id, channel, channel_conversation_key,
                                       started_at, last_message_at, process_after)
      values (v_agency_id, v_agent_id, 'whatsapp', v_conv_id, v_at, v_at,
              least(now() + v_cap, greatest(now() + v_quiet, case when v_is_media then now() + v_settle end)))
      on conflict (agency_id, channel, channel_conversation_key) where status = 'open' do nothing
      returning id into v_session_id;

      if v_session_id is null then
        -- The key is held by an open session of a DIFFERENT agent (identifiers re-assigned by an admin while a
        -- submission was open). Hand that session to processing under its own agent; never mix agents in a session.
        update submission_sessions s set status = 'ready', close_reason = 'admin', process_after = now()
         where s.agency_id = v_agency_id and s.channel = 'whatsapp' and s.channel_conversation_key = v_conv_id
           and s.status = 'open' and s.agent_id <> v_agent_id
        returning s.id into v_displaced;
        if v_displaced is not null then
          insert into automation_events (agency_id, event_type, severity, source, session_id, message_id, correlation_id, details)
          values (v_agency_id, 'session.ready', 'warning', 'n8n', v_displaced, v_message_id, v_correlation,
                  jsonb_build_object('reason', 'agent_identity_reassigned', 'detected_by', 'ingestion'));
        end if;
      end if;

      if v_session_id is not null then
        v_session_new := true;
        exit;
      end if;

      if v_attempt >= 3 then
        raise exception 'could not open or reuse a submission session' using errcode = '40001';
      end if;
    end loop;

    update whatsapp_messages set session_id = v_session_id, processing_status = 'buffered'
     where id = v_message_id;
    v_status := 'buffered';

    if v_session_new then
      insert into automation_events (agency_id, event_type, severity, source, session_id, message_id,
                                     correlation_id, details)
      values (v_agency_id, 'session.opened', 'info', 'n8n', v_session_id, v_message_id, v_correlation,
              jsonb_strip_nulls(jsonb_build_object('channel', 'whatsapp', 'agent_id', v_agent_id,
                                                   'previous_session_capped', v_capped_id)));
    end if;

    insert into automation_events (agency_id, event_type, severity, source, session_id, message_id,
                                   correlation_id, details)
    values (v_agency_id, 'whatsapp.message_received', 'info', 'n8n', v_session_id, v_message_id, v_correlation,
            jsonb_strip_nulls(jsonb_build_object(
              'provider_message_id', v_pmid, 'message_id_source', v_pmid_source, 'message_type', v_type,
              'sender', 'agent', 'agent_resolved_by', v_resolved_by,
              'agent_user_id_unlinked', case when v_resolved_by = 'phone' and v_user_id is not null and v_agent_user is null then true end,
              'session_created', v_session_new, 'media_id', v_media_id,
              'late_media', case when v_late_media then true end,
              'media_missing', case when v_is_media and v_media_id is null then true end)));

  exception
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
    'late_media', case when v_late_media then true end, 'message_id_source', v_pmid_source));
end;
$$;

revoke execute on function public.ingest_whatsapp_message(jsonb, text) from public, anon, authenticated;
grant execute on function public.ingest_whatsapp_message(jsonb, text) to service_role;
