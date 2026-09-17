-- =============================================================================
-- Phase 5 (1/2) — deterministic submission-session buffering
--
-- Adds, without touching properties or any public read path:
--   submission_buffer_config(agency)        timing configuration (defaults + agencies.settings override)
--   whatsapp_command(text)                  exact, normalized agent commands (finish / cancel)
--   submission_sessions state machine       trigger rejecting invalid status transitions
--   submission_sessions processing columns  attempt id / count / lease start / input hash
--   whatsapp_messages.command               marks command messages (excluded from extraction input)
--   ingest_whatsapp_message                 (replaced) Phase 4 ingestion + commands, hard cap, debounce
--   advance_submission_sessions()           sweep: open -> ready when due; expired processing leases
--
-- Session lifecycle (existing status vocabulary, no new states):
--   open --(quiet period | hard cap | finish command)--> ready --(claim)--> processing
--   processing --> completed (valid extraction) | needs_review (incomplete/conflicting/invalid)
--              --> ready (retryable failure / lease expired) | failed (attempts exhausted)
--   open|ready --(cancel command)--> cancelled ; needs_review --> ready|cancelled ; completed|failed --> ready (reprocess)
--
-- Rollback: see docs/rebuild/phase-05-session-buffering-ai-extraction.md (section "Rollback").
-- =============================================================================

-- ------------------------------------------------------------- configuration
create function public.submission_buffer_config(p_agency_id uuid)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  with defaults (key, value, lo, hi) as (
    values ('quiet_period_seconds',      300, 30,  86400),
           ('media_settle_seconds',       90,  0,   3600),
           ('max_session_seconds',      3600, 300, 86400),
           ('processing_lease_seconds',  900, 60,   7200),
           ('max_extraction_attempts',     3,  1,     10),
           ('retry_backoff_seconds',     120,  0,  86400)
  ),
  override as (
    select case when jsonb_typeof(a.settings -> 'submission_buffer') = 'object'
                then a.settings -> 'submission_buffer' else '{}'::jsonb end as j
    from (select 1) one
    left join agencies a on a.id = p_agency_id
  )
  select jsonb_object_agg(
           d.key,
           case when jsonb_typeof(o.j -> d.key) = 'number'
                 and (o.j ->> d.key)::numeric = trunc((o.j ->> d.key)::numeric)
                 and (o.j ->> d.key)::numeric between d.lo and d.hi
                then o.j -> d.key
                else to_jsonb(d.value) end)
  from defaults d cross join override o;
$$;

comment on function public.submission_buffer_config(uuid) is
  'Buffering/extraction timing for an agency. Defaults: quiet 300 s, media settle 90 s, hard cap 3600 s, '
  'processing lease 900 s, 3 extraction attempts, 120 s retry backoff. Override per agency with '
  'agencies.settings.submission_buffer.<key> (integers within documented bounds; invalid values fall back to defaults).';

-- ------------------------------------------------------------------ commands
create function public.whatsapp_command(p_body text)
returns text
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select case
           when p_body is null or char_length(p_body) > 40 then null
           else case regexp_replace(
                       regexp_replace(lower(p_body), '^[[:space:][:punct:]։՝՜՞«»…]+|[[:space:][:punct:]։՝՜՞«»…]+$', '', 'g'),
                       '[[:space:]]+', ' ', 'g')
                  when 'done'      then 'finish'
                  when 'finish'    then 'finish'
                  when 'finished'  then 'finish'
                  when 'complete'  then 'finish'
                  when 'готово'    then 'finish'
                  when 'վերջ'      then 'finish'
                  when 'cancel'    then 'cancel'
                  when 'stop'      then 'cancel'
                  when 'отмена'    then 'cancel'
                  when 'չեղարկել'  then 'cancel'
                  else null
                end
         end;
$$;

comment on function public.whatsapp_command(text) is
  'Exact agent command of a whole text message after trimming surrounding whitespace/punctuation and lowercasing. '
  'finish: done, finish, finished, complete, готово, վերջ. cancel: cancel, stop, отмена, չեղարկել. '
  'Anything else (e.g. "cancelled building", "done deal 3 rooms") is ordinary content.';

-- ------------------------------------------------------ whatsapp_messages.command
alter table public.whatsapp_messages
  add column command text,
  add constraint whatsapp_messages_command_check check (command in ('finish', 'cancel'));

comment on column public.whatsapp_messages.command is
  'Set when the message is an exact agent command (finish/cancel). Command messages are never extraction input.';

-- ---------------------------------------------- submission_sessions: processing
alter table public.submission_sessions
  add column processing_attempt_id uuid,
  add column processing_attempts   smallint not null default 0,
  add column processing_started_at timestamptz,
  add column processing_input_hash text,
  add constraint submission_sessions_processing_attempts_check check (processing_attempts between 0 and 1000),
  add constraint submission_sessions_processing_consistency check (
    (status = 'processing') = (processing_attempt_id is not null)
    and (processing_attempt_id is null) = (processing_started_at is null)
    and (processing_attempt_id is null) = (processing_input_hash is null)
  ),
  add constraint submission_sessions_processing_input_hash_format
    check (processing_input_hash ~ '^[0-9a-f]{64}$');

create unique index submission_sessions_processing_attempt_key
  on public.submission_sessions (processing_attempt_id) where processing_attempt_id is not null;
create index submission_sessions_open_created_idx
  on public.submission_sessions (created_at) where status = 'open';

comment on column public.submission_sessions.process_after is
  'open: earliest time the quiet period (and media settle period) allows the session to become ready. '
  'ready: earliest time it may be claimed for extraction (media settle after a finish command, retry backoff).';
comment on column public.submission_sessions.processing_attempt_id is
  'Id of the current extraction attempt while status = processing. Results are recorded against it exactly once.';
comment on column public.submission_sessions.processing_attempts is
  'Extraction attempts in the current processing cycle (reset by an explicit reprocess request).';

-- ------------------------------------------------------------ state machine
create function public.submission_sessions_status_transition()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'open' then
      raise exception 'submission sessions must start open (got %)', new.status using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if new.status is distinct from old.status and not (
       (old.status = 'open'         and new.status in ('ready', 'cancelled'))
    or (old.status = 'ready'        and new.status in ('processing', 'cancelled'))
    or (old.status = 'processing'   and new.status in ('completed', 'needs_review', 'ready', 'failed'))
    or (old.status = 'needs_review' and new.status in ('ready', 'cancelled'))
    or (old.status = 'completed'    and new.status = 'ready')
    or (old.status = 'failed'       and new.status = 'ready')
  ) then
    raise exception 'invalid submission session transition: % -> %', old.status, new.status
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke execute on function public.submission_sessions_status_transition() from public, anon, authenticated;

create trigger submission_sessions_status_transition_trg
  before insert or update of status on public.submission_sessions
  for each row execute function public.submission_sessions_status_transition();

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
    select g.id, g.is_active into v_agent_id, v_agent_ok
    from agents g where g.agency_id = v_agency_id and g.whatsapp_phone = v_phone;

    -- Commands exist only for active agents' plain text messages.
    if v_agent_ok and v_type = 'text' then
      v_command := whatsapp_command(v_body);
    end if;

    -- ------------------------------------------------------ idempotent insert
    insert into whatsapp_messages (agency_id, agent_id, provider, provider_message_id, message_id_source,
                                   sender_phone, sender_name, provider_contact_id, recipient_phone_number_id,
                                   message_type, body, provider_timestamp, context_provider_message_id,
                                   raw_payload, processing_status, command)
    values (v_agency_id, case when v_agent_ok then v_agent_id end, 'whatsapp_cloud', v_pmid, v_pmid_source,
            v_phone, v_name, v_wa_id, v_recipient,
            v_type, v_body, v_ts, v_context,
            v_raw, 'received', v_command)
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

    if not coalesce(v_agent_ok, false) then
      -- ---------------------------------------------------- unresolved sender (Phase 4, unchanged)
      update whatsapp_messages set processing_status = 'unresolved_sender' where id = v_message_id;
      v_status := 'unresolved_sender';

      insert into automation_events (agency_id, event_type, severity, source, message_id, correlation_id, details)
      values (v_agency_id, 'whatsapp.sender_unresolved', 'warning', 'n8n', v_message_id, v_correlation,
              jsonb_strip_nulls(jsonb_build_object(
                'provider_message_id', v_pmid, 'message_id_source', v_pmid_source, 'message_type', v_type,
                'reason', case when v_agent_id is null then 'unknown_sender' else 'agent_inactive' end,
                'media_id', v_media_id)));

      return jsonb_strip_nulls(jsonb_build_object(
        'ok', true, 'outcome', 'stored', 'message_id', v_message_id, 'session_created', false,
        'processing_status', v_status, 'media_id', v_media_id, 'message_id_source', v_pmid_source));
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
         and s.channel_conversation_key = v_phone and s.status = 'open'
       for update;

      if v_target.id is null and v_command = 'cancel' then
        -- A submission that is ready but not yet claimed can still be cancelled.
        select * into v_target from submission_sessions s
         where s.agency_id = v_agency_id and s.channel = 'whatsapp'
           and s.channel_conversation_key = v_phone and s.status = 'ready'
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
         and s.channel_conversation_key = v_phone and s.status = 'open'
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
           and s.channel_conversation_key = v_phone and s.status = 'ready'
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
      values (v_agency_id, v_agent_id, 'whatsapp', v_phone, v_at, v_at,
              least(now() + v_cap, greatest(now() + v_quiet, case when v_is_media then now() + v_settle end)))
      on conflict (agency_id, channel, channel_conversation_key) where status = 'open' do nothing
      returning id into v_session_id;

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
              'sender', 'agent', 'session_created', v_session_new, 'media_id', v_media_id,
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

-- ------------------------------------------------------------------- sweep
create function public.advance_submission_sessions(p_correlation_id text default null)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_correlation text := left(nullif(btrim(p_correlation_id), ''), 200);
  r        record;
  v_cfg    jsonb;
  v_reason text;
  v_ready  integer := 0;
  v_capped integer := 0;
  v_leases integer := 0;
begin
  -- open -> ready: quiet period (incl. media settle) elapsed, or hard cap reached.
  for r in
    select s.id, s.agency_id, s.created_at, s.process_after, s.updated_at
      from submission_sessions s
     where s.status = 'open'
       -- process_after is capped at created_at + max_session, so this also covers the hard cap.
       and (s.process_after is null or s.process_after <= now())
     order by s.created_at
     for update skip locked
  loop
    v_cfg := submission_buffer_config(r.agency_id);
    if r.created_at + make_interval(secs => (v_cfg ->> 'max_session_seconds')::int) <= now() then
      v_reason := 'max_duration';
    elsif coalesce(r.process_after,
                   r.updated_at + make_interval(secs => (v_cfg ->> 'quiet_period_seconds')::int)) <= now() then
      v_reason := 'quiet_period';
    else
      continue;
    end if;

    update submission_sessions
       set status = 'ready', close_reason = v_reason, process_after = now()
     where id = r.id;

    insert into automation_events (agency_id, event_type, severity, source, session_id, correlation_id, details)
    values (r.agency_id, 'session.ready', 'info', 'n8n', r.id, v_correlation,
            jsonb_build_object('reason', v_reason, 'detected_by', 'sweep',
                               'message_count', (select count(*) from whatsapp_messages m where m.session_id = r.id)));

    if v_reason = 'max_duration' then v_capped := v_capped + 1; else v_ready := v_ready + 1; end if;
  end loop;

  -- processing with an expired lease (worker crashed or timed out): count as a failed attempt.
  for r in
    select s.*
      from submission_sessions s
     where s.status = 'processing'
     order by s.processing_started_at
     for update skip locked
  loop
    v_cfg := submission_buffer_config(r.agency_id);
    continue when r.processing_started_at + make_interval(secs => (v_cfg ->> 'processing_lease_seconds')::int) > now();

    perform apply_extraction_failure(r.id, 'failed', 'lease_expired',
                                     'processing lease expired before a result was recorded',
                                     null, null, null, null, v_correlation);
    v_leases := v_leases + 1;
  end loop;

  return jsonb_build_object('ok', true, 'ready_quiet_period', v_ready, 'ready_max_duration', v_capped,
                            'expired_leases', v_leases);
end;
$$;

revoke execute on function public.submission_buffer_config(uuid) from public, anon, authenticated;
revoke execute on function public.whatsapp_command(text) from public, anon, authenticated;
revoke execute on function public.advance_submission_sessions(text) from public, anon, authenticated;
grant execute on function public.submission_buffer_config(uuid) to service_role;
grant execute on function public.whatsapp_command(text) to service_role;
grant execute on function public.advance_submission_sessions(text) to service_role;

comment on function public.advance_submission_sessions(text) is
  'Deterministic sweep (called by the n8n scheduler): open sessions whose quiet period/media settle elapsed or '
  'that reached the hard cap become ready; processing sessions whose lease expired are recorded as a failed '
  'attempt (retried or failed). Uses SKIP LOCKED, so overlapping sweeps and concurrent ingestion are safe.';
