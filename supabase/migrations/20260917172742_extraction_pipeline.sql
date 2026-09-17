-- =============================================================================
-- Phase 5 (2/2) — claiming, canonical extraction input, deterministic validation, results
--
--   build_extraction_input(session)          canonical, deterministic AI input (no ids, no secrets)
--   claim_submission_session()               atomically claims ONE ready session (SKIP LOCKED) -> attempt id
--   validate_property_extraction(out, input) deterministic validation of untrusted AI output
--   record_extraction_result(attempt, ...)   append-only result, exactly once per attempt
--   record_extraction_failure(attempt, ...)  append-only failed attempt; retry with backoff or fail
--   apply_extraction_failure(...)            shared failure transition (also used for expired leases)
--   request_session_reprocessing(session)    intentional reprocessing -> new attempt -> new result
--
-- extraction_results gains attempt_id (unique), attempt_number, schema_version, input_hash, raw_output;
-- validation_status gains 'incomplete' and 'conflicting'.
--
-- HARD RULE: nothing here reads from or writes to properties, property_images or any public read model.
-- Rollback: docs/rebuild/phase-05-session-buffering-ai-extraction.md, section "Rollback".
-- =============================================================================

-- ------------------------------------------------------ extraction_results columns
alter table public.extraction_results
  add column attempt_id     uuid,
  add column attempt_number smallint,
  add column schema_version text,
  add column input_hash     text,
  add column raw_output     text,
  add constraint extraction_results_attempt_number_check check (attempt_number >= 1),
  add constraint extraction_results_schema_version_check check (schema_version ~ '^[0-9]{1,3}$'),
  add constraint extraction_results_input_hash_format check (input_hash ~ '^[0-9a-f]{64}$'),
  add constraint extraction_results_raw_output_check check (char_length(raw_output) <= 200000),
  add constraint extraction_results_prompt_version_format check (prompt_version ~ '^[a-z0-9][a-z0-9.-]{0,59}$');

create unique index extraction_results_attempt_key
  on public.extraction_results (attempt_id) where attempt_id is not null;

alter table public.extraction_results drop constraint extraction_results_validation_status_check;
alter table public.extraction_results
  add constraint extraction_results_validation_status_check
    check (validation_status in ('valid', 'incomplete', 'conflicting', 'invalid', 'needs_review'));

comment on column public.extraction_results.attempt_id is
  'Processing attempt (submission_sessions.processing_attempt_id at claim time). Unique: one result row per attempt.';
comment on column public.extraction_results.raw_output is
  'Verbatim model output (untrusted), kept for audit. extracted_data holds the validated structure.';
comment on column public.extraction_results.validation_status is
  'Deterministic validation outside the AI: valid | incomplete | conflicting | invalid (needs_review is legacy).';

-- ------------------------------------------------------------------ helpers
create function public.extraction_issue(p_severity text, p_code text, p_field text, p_message text)
returns jsonb
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select jsonb_strip_nulls(jsonb_build_object('severity', p_severity, 'code', p_code, 'field', p_field,
                                              'message', p_message));
$$;

create function public.extraction_evidence_text(p_text text)
returns text
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select btrim(regexp_replace(lower(coalesce(p_text, '')), '[[:space:]]+', ' ', 'g'));
$$;

create function public.redact_error_text(p_text text)
returns text
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select left(regexp_replace(coalesce(p_text, ''),
                             '(sk-[A-Za-z0-9_-]{8,}|eyJ[A-Za-z0-9_.-]{20,}|Bearer\s+\S+|sb_(secret|publishable)_\S+|x-api-key\S*\s*\S+)',
                             '[redacted]', 'gi'), 500);
$$;

-- ------------------------------------------------------ canonical extraction input
create function public.build_extraction_input(p_session_id uuid)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  with sess as (
    select s.id, g.name as agent_name
      from submission_sessions s
      join agents g on g.id = s.agent_id
     where s.id = p_session_id
  ),
  ordered as (
    select m.id, m.message_type, m.body, m.provider_message_id, m.context_provider_message_id,
           coalesce(m.provider_timestamp, m.received_at) as sent_at,
           row_number() over (order by coalesce(m.provider_timestamp, m.received_at), m.received_at,
                                       m.provider_message_id) as seq
      from whatsapp_messages m
     where m.session_id = p_session_id
       and m.command is null
       and m.message_type not in ('reaction', 'system', 'sticker')
  ),
  items as (
    select o.seq, o.id,
           jsonb_strip_nulls(jsonb_build_object(
             'seq', o.seq,
             'sent_at', to_char(o.sent_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
             'sender', 'agent',
             'type', o.message_type,
             'text', o.body,
             'reply_to_seq', (select r.seq from ordered r where r.provider_message_id = o.context_provider_message_id),
             'media', (select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                                 'kind', o.message_type, 'mime_type', w.mime_type, 'filename', w.filename,
                                 'provider_media_id', w.provider_media_id)) order by w.created_at, w.id)
                         from whatsapp_media w where w.message_id = o.id)
           )) as j
      from ordered o
  )
  select jsonb_build_object(
           'input', jsonb_build_object(
             'schema', 'vip-realty.extraction-input.v1',
             'channel', 'whatsapp',
             'sender', jsonb_build_object('role', 'agent', 'name', sess.agent_name),
             'message_count', (select count(*) from items),
             'media_count', (select count(*) from items i, jsonb_array_elements(coalesce(i.j -> 'media', '[]'))),
             'messages', coalesce((select jsonb_agg(i.j order by i.seq) from items i), '[]'::jsonb)),
           'message_ids', coalesce((select jsonb_agg(i.id order by i.seq) from items i), '[]'::jsonb))
    from sess;
$$;

comment on function public.build_extraction_input(uuid) is
  'Canonical extraction input of a session: non-command messages in deterministic order (provider time, arrival, '
  'provider id) with seq, UTC time, type, text and media metadata. Contains no database ids, phone numbers, '
  'raw provider payloads or credentials. message_ids (internal) are returned separately and never sent to the AI.';

-- ------------------------------------------------------------ validation
create function public.validate_property_extraction(p_output jsonb, p_input jsonb)
returns jsonb
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  c_fields   constant text[] := array['title', 'description', 'intent', 'property_type', 'country', 'city',
                                      'district', 'address', 'latitude', 'longitude', 'price', 'currency',
                                      'price_negotiable', 'price_period', 'area_sqm', 'land_area_sqm', 'rooms',
                                      'bedrooms', 'bathrooms', 'floor', 'total_floors', 'year_built', 'features'];
  c_critical constant text[] := array['intent', 'property_type', 'city', 'price', 'currency'];
  c_statuses constant text[] := array['explicit', 'normalized', 'uncertain', 'conflicting', 'unknown'];
  c_types    constant text[] := array['apartment', 'penthouse', 'house', 'villa', 'townhouse', 'commercial', 'office',
                                      'retail', 'warehouse', 'land', 'garage', 'other'];
  v_issues     jsonb := '[]'::jsonb;
  v_fields     jsonb;
  v_msgs       jsonb := coalesce(p_input -> 'messages', '[]'::jsonb);
  v_max_seq    integer;
  v_name       text;
  v_key        text;
  v_entry      jsonb;
  v_value      jsonb;
  v_status     text;
  v_src        jsonb;
  v_seq        jsonb;
  v_n          integer;
  v_src_text   text;
  v_src_ok     boolean;
  v_evidence   text;
  v_text       text;
  v_num        numeric;
  v_ok         boolean;
  v_property   jsonb := '{}'::jsonb;
  v_statuses   jsonb := '{}'::jsonb;
  v_conflicts  jsonb;
  v_conflict   jsonb;
  v_conflicted text[] := '{}';
  v_unresolved boolean := false;
  v_incomplete boolean := false;
  v_result     text;
begin
  v_max_seq := jsonb_array_length(v_msgs);

  if p_output is null or jsonb_typeof(p_output) <> 'object' or jsonb_typeof(p_output -> 'fields') <> 'object' then
    return jsonb_build_object('status', 'invalid', 'property', '{}'::jsonb, 'statuses', '{}'::jsonb,
                              'issues', jsonb_build_array(extraction_issue('error', 'invalid_structure', null,
                                                          'output must be an object with a "fields" object')));
  end if;
  v_fields := p_output -> 'fields';

  for v_key in select jsonb_object_keys(p_output) loop
    if v_key not in ('fields', 'conflicts', 'notes', 'languages') then
      v_issues := v_issues || extraction_issue('error', 'unexpected_key', left(v_key, 60), 'unexpected top-level key');
    end if;
  end loop;

  for v_key in select jsonb_object_keys(v_fields) loop
    if v_key <> all (c_fields) then
      v_issues := v_issues || extraction_issue('error', 'unexpected_field', left(v_key, 60), 'field is not in the extraction schema');
    end if;
  end loop;

  foreach v_name in array c_fields loop
    v_entry := v_fields -> v_name;

    if v_entry is null then
      v_issues := v_issues || extraction_issue('error', 'missing_field', v_name, 'every schema field must be present');
      continue;
    end if;
    if jsonb_typeof(v_entry) <> 'object' then
      v_issues := v_issues || extraction_issue('error', 'invalid_field_entry', v_name, 'field entry must be an object');
      continue;
    end if;

    v_ok := true;
    for v_key in select jsonb_object_keys(v_entry) loop
      if v_key not in ('value', 'status', 'source_messages', 'evidence') then
        v_issues := v_issues || extraction_issue('error', 'unexpected_key', v_name, 'unexpected key ' || left(v_key, 40));
        v_ok := false;
      end if;
    end loop;
    if not (v_entry ? 'value' and v_entry ? 'status' and v_entry ? 'source_messages' and v_entry ? 'evidence') then
      v_issues := v_issues || extraction_issue('error', 'missing_key', v_name,
                                               'value, status, source_messages and evidence are required');
      continue;
    end if;
    continue when not v_ok;

    v_status := v_entry ->> 'status';
    v_value  := v_entry -> 'value';
    if v_status is null or v_status <> all (c_statuses) then
      v_issues := v_issues || extraction_issue('error', 'invalid_status', v_name,
                                               'status must be explicit|normalized|uncertain|conflicting|unknown');
      continue;
    end if;
    v_statuses := v_statuses || jsonb_build_object(v_name, v_status);

    if v_status in ('unknown', 'conflicting') and jsonb_typeof(v_value) <> 'null' then
      v_issues := v_issues || extraction_issue('error', 'value_must_be_null', v_name,
                                               v_status || ' fields must have a null value');
      continue;
    end if;
    if v_status in ('explicit', 'normalized', 'uncertain') and jsonb_typeof(v_value) = 'null' then
      v_issues := v_issues || extraction_issue('error', 'value_required', v_name,
                                               v_status || ' fields must have a value (use unknown for null)');
      continue;
    end if;

    -- source messages must exist in the input
    v_src := v_entry -> 'source_messages';
    if jsonb_typeof(v_src) <> 'array' then
      v_issues := v_issues || extraction_issue('error', 'invalid_source_messages', v_name, 'source_messages must be an array');
      continue;
    end if;
    v_src_text := '';
    v_src_ok := true;
    for v_seq in select e from jsonb_array_elements(v_src) e loop
      if jsonb_typeof(v_seq) <> 'number' or (v_seq #>> '{}')::numeric <> trunc((v_seq #>> '{}')::numeric)
         or (v_seq #>> '{}')::numeric < 1 or (v_seq #>> '{}')::numeric > v_max_seq then
        v_src_ok := false;
      else
        v_n := (v_seq #>> '{}')::integer;
        v_src_text := v_src_text || ' ' || coalesce(v_msgs -> (v_n - 1) ->> 'text', '') || ' ' ||
                      coalesce((select string_agg(x ->> 'filename', ' ')
                                  from jsonb_array_elements(coalesce(v_msgs -> (v_n - 1) -> 'media', '[]'::jsonb)) x), '');
      end if;
    end loop;
    if not v_src_ok then
      v_issues := v_issues || extraction_issue('error', 'invalid_source_messages', v_name,
                                               'source_messages must reference existing message seq numbers');
      continue;
    end if;

    continue when jsonb_typeof(v_value) = 'null';

    -- anti-hallucination: every non-null value must be backed by a verbatim quote from its source messages
    -- (only a composed title may omit evidence)
    if not (v_name = 'title' and v_status = 'normalized') then
      v_evidence := case when jsonb_typeof(v_entry -> 'evidence') = 'string' then v_entry ->> 'evidence' end;
      if jsonb_array_length(v_src) = 0 then
        v_issues := v_issues || extraction_issue('error', 'source_required', v_name, 'a value needs at least one source message');
        continue;
      elsif extraction_evidence_text(v_evidence) = ''
         or position(extraction_evidence_text(v_evidence) in extraction_evidence_text(v_src_text)) = 0 then
        v_issues := v_issues || extraction_issue('error', 'evidence_not_found', v_name,
                                                 'evidence is not a verbatim quote from the cited messages');
        continue;
      end if;
    end if;

    -- types and ranges (mirrors the properties constraints)
    v_ok := true;
    v_text := case when jsonb_typeof(v_value) = 'string' then v_value #>> '{}' end;
    v_num  := case when jsonb_typeof(v_value) = 'number' then (v_value #>> '{}')::numeric end;
    case v_name
      when 'title'            then v_ok := char_length(btrim(v_text)) between 3 and 160;
      when 'description'      then v_ok := char_length(btrim(v_text)) between 1 and 5000;
      when 'city'             then v_ok := char_length(btrim(v_text)) between 1 and 120;
      when 'district'         then v_ok := char_length(btrim(v_text)) between 1 and 120;
      when 'address'          then v_ok := char_length(btrim(v_text)) between 1 and 300;
      when 'intent'           then v_ok := v_text in ('buy', 'rent');
      when 'property_type'    then v_ok := v_text = any (c_types);
      when 'country'          then v_ok := v_text ~ '^[A-Z]{2}$';
      when 'currency'         then v_ok := v_text in ('USD', 'AMD', 'EUR', 'RUB');
      when 'price_period'     then v_ok := v_text in ('month', 'day', 'year');
      when 'price_negotiable' then v_ok := jsonb_typeof(v_value) = 'boolean';
      when 'features' then
        v_ok := jsonb_typeof(v_value) = 'array'
                and jsonb_array_length(v_value) between 1 and 40
                and not exists (select 1 from jsonb_array_elements(v_value) f
                                 where jsonb_typeof(f) <> 'string'
                                    or (f #>> '{}') !~ '^[a-z0-9]+(_[a-z0-9]+)*$'
                                    or char_length(f #>> '{}') > 40)
                and (select count(distinct f) from jsonb_array_elements(v_value) f) = jsonb_array_length(v_value);
      when 'latitude'      then v_ok := v_num between -90 and 90;
      when 'longitude'     then v_ok := v_num between -180 and 180;
      when 'price'         then v_ok := v_num > 0 and v_num <= 100000000000;
      when 'area_sqm'      then v_ok := v_num > 0 and v_num < 100000;
      when 'land_area_sqm' then v_ok := v_num > 0 and v_num < 1000000000;
      when 'rooms'         then v_ok := v_num = trunc(v_num) and v_num between 0 and 50;
      when 'bedrooms'      then v_ok := v_num = trunc(v_num) and v_num between 0 and 50;
      when 'bathrooms'     then v_ok := v_num = trunc(v_num) and v_num between 0 and 20;
      when 'floor'         then v_ok := v_num = trunc(v_num) and v_num between -5 and 200;
      when 'total_floors'  then v_ok := v_num = trunc(v_num) and v_num between 1 and 200;
      when 'year_built'    then v_ok := v_num = trunc(v_num)
                                        and v_num between 1800 and extract(year from now())::integer + 5;
    end case;
    if not coalesce(v_ok, false) then
      v_issues := v_issues || extraction_issue('error', 'invalid_value', v_name, 'value has the wrong type or is out of range');
      continue;
    end if;

    if v_status = 'uncertain' then
      v_issues := v_issues || extraction_issue('warning', 'uncertain_value', v_name,
                                               'the agent expressed uncertainty; value kept out of property data');
    else
      v_property := v_property || jsonb_build_object(v_name, v_value);
    end if;
  end loop;

  -- conflicts
  v_conflicts := coalesce(p_output -> 'conflicts', '[]'::jsonb);
  if jsonb_typeof(v_conflicts) <> 'array' then
    v_issues := v_issues || extraction_issue('error', 'invalid_conflicts', null, 'conflicts must be an array');
  else
    for v_conflict in select c from jsonb_array_elements(v_conflicts) c loop
      if jsonb_typeof(v_conflict) <> 'object'
         or (v_conflict ->> 'field') is null or (v_conflict ->> 'field') <> all (c_fields)
         or jsonb_typeof(v_conflict -> 'values') <> 'array' or jsonb_array_length(v_conflict -> 'values') < 2
         or jsonb_typeof(v_conflict -> 'source_messages') <> 'array'
         or coalesce(v_conflict ->> 'resolution', '') not in ('latest_correction', 'unresolved')
         or exists (select 1 from jsonb_object_keys(v_conflict) k
                     where k not in ('field', 'values', 'source_messages', 'resolution', 'note'))
         or exists (select 1 from jsonb_array_elements(v_conflict -> 'source_messages') e
                     where jsonb_typeof(e) <> 'number' or (e #>> '{}')::numeric < 1 or (e #>> '{}')::numeric > v_max_seq)
      then
        v_issues := v_issues || extraction_issue('error', 'invalid_conflict', left(v_conflict ->> 'field', 60),
                                                 'conflict needs field, >= 2 values, source_messages and resolution');
        continue;
      end if;

      v_name := v_conflict ->> 'field';
      v_conflicted := v_conflicted || v_name;
      if v_conflict ->> 'resolution' = 'unresolved' then
        v_unresolved := true;
        if coalesce(v_statuses ->> v_name, '') <> 'conflicting' then
          v_issues := v_issues || extraction_issue('error', 'conflict_status_mismatch', v_name,
                                                   'an unresolved conflict requires field status conflicting');
        end if;
      else
        v_issues := v_issues || extraction_issue('warning', 'corrected_value', v_name,
                                                 'the agent corrected this value; the latest statement was used');
        if coalesce(v_statuses ->> v_name, '') in ('conflicting', 'unknown') then
          v_issues := v_issues || extraction_issue('error', 'conflict_status_mismatch', v_name,
                                                   'a resolved conflict requires the corrected value');
        end if;
      end if;
    end loop;
  end if;

  for v_name in select key from jsonb_each_text(v_statuses) where value = 'conflicting' loop
    v_unresolved := true;
    if v_name <> all (v_conflicted) then
      v_issues := v_issues || extraction_issue('error', 'conflict_missing', v_name,
                                               'a conflicting field needs an entry in conflicts');
    end if;
  end loop;

  if p_output ? 'notes' and (jsonb_typeof(p_output -> 'notes') <> 'array'
      or jsonb_array_length(p_output -> 'notes') > 20
      or exists (select 1 from jsonb_array_elements(p_output -> 'notes') n
                  where jsonb_typeof(n) <> 'string' or char_length(n #>> '{}') > 500)) then
    v_issues := v_issues || extraction_issue('error', 'invalid_notes', null, 'notes must be up to 20 short strings');
  end if;
  if p_output ? 'languages' and (jsonb_typeof(p_output -> 'languages') <> 'array'
      or jsonb_array_length(p_output -> 'languages') > 5
      or exists (select 1 from jsonb_array_elements(p_output -> 'languages') l
                  where jsonb_typeof(l) <> 'string' or (l #>> '{}') !~ '^[a-z]{2,3}$')) then
    v_issues := v_issues || extraction_issue('error', 'invalid_languages', null, 'languages must be ISO 639 codes');
  end if;

  -- cross-field rules on trusted values
  if (v_property ? 'latitude') <> (v_property ? 'longitude') then
    v_issues := v_issues || extraction_issue('error', 'coordinates_incomplete', 'latitude', 'latitude and longitude go together');
  end if;
  if (v_property ->> 'floor')::numeric > (v_property ->> 'total_floors')::numeric then
    v_issues := v_issues || extraction_issue('error', 'floor_above_total', 'floor', 'floor exceeds total_floors');
  end if;
  if v_property ->> 'intent' = 'buy' and v_property ? 'price_period' then
    v_issues := v_issues || extraction_issue('error', 'sale_with_price_period', 'price_period', 'a sale price has no period');
  end if;
  if v_property ->> 'intent' = 'rent' and v_property ? 'price' and not v_property ? 'price_period' then
    v_issues := v_issues || extraction_issue('warning', 'rent_without_period', 'price_period', 'rental period not stated');
  end if;

  foreach v_name in array c_critical loop
    if not v_property ? v_name then
      v_incomplete := true;
      v_issues := v_issues || extraction_issue('review', 'missing_critical_field', v_name,
                                               'required before a listing could be created');
    end if;
  end loop;

  v_result := case
                when exists (select 1 from jsonb_array_elements(v_issues) i where i ->> 'severity' = 'error') then 'invalid'
                when v_unresolved then 'conflicting'
                when v_incomplete then 'incomplete'
                else 'valid'
              end;

  return jsonb_build_object(
    'status', v_result,
    'issues', v_issues,
    'statuses', v_statuses,
    'property', case when v_result = 'invalid' then '{}'::jsonb else v_property end);
end;
$$;

comment on function public.validate_property_extraction(jsonb, jsonb) is
  'Deterministic validation of untrusted AI output against extraction schema v1 and the canonical input: '
  'structure, field set, status/value consistency, source message references, verbatim evidence (anti-hallucination), '
  'enums, types and ranges, cross-field rules, conflict bookkeeping. Result: valid | incomplete | conflicting | invalid.';

-- ------------------------------------------------------------------ claim
create function public.claim_submission_session(p_worker text default null)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_worker  text := left(nullif(btrim(p_worker), ''), 200);
  v_session submission_sessions%rowtype;
  v_built   jsonb;
  v_hash    text;
  v_attempt uuid := gen_random_uuid();
  v_number  integer;
begin
  select * into v_session
    from submission_sessions s
   where s.status = 'ready'
     and coalesce(s.process_after, '-infinity'::timestamptz) <= now()
   order by s.process_after nulls first, s.created_at, s.id
   limit 1
   for update skip locked;

  if v_session.id is null then
    return jsonb_build_object('claimed', false);
  end if;

  v_built := build_extraction_input(v_session.id);

  if jsonb_array_length(v_built -> 'message_ids') = 0 then
    update submission_sessions set status = 'cancelled', close_reason = 'no_action', closed_at = now()
     where id = v_session.id;
    insert into automation_events (agency_id, event_type, severity, source, session_id, correlation_id, details)
    values (v_session.agency_id, 'session.cancelled', 'info', 'n8n', v_session.id, v_worker,
            jsonb_build_object('reason', 'no_content'));
    return jsonb_build_object('claimed', false, 'skipped', 'no_content');
  end if;

  v_hash := encode(sha256(convert_to((v_built -> 'input')::text, 'UTF8')), 'hex');

  update submission_sessions
     set status = 'processing',
         processing_attempt_id = v_attempt,
         processing_attempts   = processing_attempts + 1,
         processing_started_at = now(),
         processing_input_hash = v_hash,
         last_error            = null
   where id = v_session.id
  returning processing_attempts into v_number;

  update whatsapp_messages set processing_status = 'processing'
   where id in (select (jsonb_array_elements_text(v_built -> 'message_ids'))::uuid)
     and processing_status = 'buffered';

  insert into automation_events (agency_id, event_type, severity, source, session_id, correlation_id, details)
  values (v_session.agency_id, 'extraction.started', 'info', 'n8n', v_session.id, v_worker,
          jsonb_build_object('attempt_id', v_attempt, 'attempt_number', v_number,
                             'message_count', v_built -> 'input' -> 'message_count',
                             'media_count', v_built -> 'input' -> 'media_count', 'input_hash', v_hash));

  return jsonb_build_object('claimed', true, 'attempt_id', v_attempt, 'attempt_number', v_number,
                            'input_hash', v_hash, 'extraction_input', v_built -> 'input');
end;
$$;

comment on function public.claim_submission_session(text) is
  'Atomically claims the oldest due ready session (FOR UPDATE SKIP LOCKED + status transition ready -> processing) '
  'and returns a new attempt id with the canonical extraction input. Concurrent callers never receive the same session.';

-- -------------------------------------------------------- failure transition
create function public.apply_extraction_failure(p_session_id uuid, p_result_status text, p_code text, p_message text,
                                                p_provider text, p_model text, p_prompt_version text,
                                                p_raw_output text, p_correlation_id text)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_session  submission_sessions%rowtype;
  v_built    jsonb;
  v_cfg      jsonb;
  v_code     text := case when p_code ~ '^[a-z][a-z0-9_]{0,39}$' then p_code else 'unknown_error' end;
  v_result   uuid;
  v_ids      uuid[];
  v_next     text;
  v_retry_at timestamptz;
begin
  select * into v_session from submission_sessions where id = p_session_id and status = 'processing' for update;
  if v_session.id is null then
    return jsonb_build_object('ok', false, 'outcome', 'stale_attempt');
  end if;

  v_built := build_extraction_input(v_session.id);
  v_ids := array(select (jsonb_array_elements_text(v_built -> 'message_ids'))::uuid);
  if cardinality(v_ids) = 0 then
    v_ids := array(select m.id from whatsapp_messages m where m.session_id = v_session.id order by m.received_at);
  end if;

  insert into extraction_results (agency_id, session_id, provider, model, prompt_version, input_message_ids, status,
                                  error, validation_status, attempt_id, attempt_number, schema_version, input_hash,
                                  raw_output)
  values (v_session.agency_id, v_session.id,
          coalesce(nullif(btrim(left(p_provider, 60)), ''), 'n8n'),
          coalesce(nullif(btrim(left(p_model, 120)), ''), 'unknown'),
          case when p_prompt_version ~ '^[a-z0-9][a-z0-9.-]{0,59}$' then p_prompt_version end,
          v_ids,
          case when p_result_status = 'invalid_output' then 'invalid_output' else 'failed' end,
          v_code || ': ' || redact_error_text(p_message),
          null, v_session.processing_attempt_id, v_session.processing_attempts, '1',
          v_session.processing_input_hash, left(p_raw_output, 200000))
  returning id into v_result;

  v_cfg := submission_buffer_config(v_session.agency_id);
  if v_session.processing_attempts < (v_cfg ->> 'max_extraction_attempts')::int then
    v_next := 'ready';
    v_retry_at := now() + make_interval(secs => (v_cfg ->> 'retry_backoff_seconds')::int * v_session.processing_attempts);
    update submission_sessions
       set status = 'ready', process_after = v_retry_at, last_error = v_code,
           processing_attempt_id = null, processing_started_at = null, processing_input_hash = null
     where id = v_session.id;
    update whatsapp_messages set processing_status = 'buffered'
     where session_id = v_session.id and processing_status = 'processing';
  else
    v_next := 'failed';
    update submission_sessions
       set status = 'failed', closed_at = now(), last_error = v_code,
           processing_attempt_id = null, processing_started_at = null, processing_input_hash = null
     where id = v_session.id;
    update whatsapp_messages set processing_status = 'failed'
     where session_id = v_session.id and processing_status in ('buffered', 'processing');
  end if;

  insert into automation_events (agency_id, event_type, severity, source, session_id, correlation_id, details)
  values (v_session.agency_id, 'extraction.failed', case when v_next = 'failed' then 'error' else 'warning' end, 'n8n',
          v_session.id, left(p_correlation_id, 200),
          jsonb_build_object('attempt_id', v_session.processing_attempt_id, 'attempt_number', v_session.processing_attempts,
                             'extraction_result_id', v_result, 'result_status', p_result_status, 'error_code', v_code));

  if v_next = 'ready' then
    insert into automation_events (agency_id, event_type, severity, source, session_id, correlation_id, details)
    values (v_session.agency_id, 'extraction.retried', 'info', 'n8n', v_session.id, left(p_correlation_id, 200),
            jsonb_build_object('next_attempt_number', v_session.processing_attempts + 1, 'not_before', v_retry_at,
                               'previous_error_code', v_code));
  else
    insert into automation_events (agency_id, event_type, severity, source, session_id, correlation_id, details)
    values (v_session.agency_id, 'session.failed', 'error', 'n8n', v_session.id, left(p_correlation_id, 200),
            jsonb_build_object('attempts', v_session.processing_attempts, 'last_error_code', v_code));
  end if;

  return jsonb_build_object('ok', true, 'outcome', 'failure_recorded', 'extraction_result_id', v_result,
                            'session_status', v_next, 'retry_at', v_retry_at, 'error_code', v_code);
end;
$$;

-- ----------------------------------------------------------- record result
create function public.record_extraction_result(p_attempt_id uuid, p_provider text, p_model text,
                                                p_prompt_version text, p_raw_output text,
                                                p_correlation_id text default null)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_session   submission_sessions%rowtype;
  v_existing  extraction_results%rowtype;
  v_built     jsonb;
  v_hash      text;
  v_text      text;
  v_json      jsonb;
  v_val       jsonb;
  v_vstatus   text;
  v_ids       uuid[];
  v_media     jsonb;
  v_data      jsonb;
  v_result    uuid;
  v_next      text;
  v_event     text;
  v_corr      text := left(nullif(btrim(p_correlation_id), ''), 200);
begin
  if p_attempt_id is null
     or coalesce(btrim(p_provider), '') = '' or char_length(p_provider) > 60
     or coalesce(btrim(p_model), '') = '' or char_length(p_model) > 120
     or coalesce(p_prompt_version, '') !~ '^[a-z0-9][a-z0-9.-]{0,59}$' then
    return jsonb_build_object('ok', false, 'outcome', 'invalid_request');
  end if;

  -- Lock first, then check for an existing result: a concurrent call for the same attempt waits here
  -- and then sees the committed result (idempotent), never a second insert.
  select * into v_session from submission_sessions where processing_attempt_id = p_attempt_id for update;

  select * into v_existing from extraction_results where attempt_id = p_attempt_id;
  if v_existing.id is not null then
    return jsonb_build_object('ok', true, 'outcome', 'duplicate', 'extraction_result_id', v_existing.id,
                              'status', v_existing.status, 'validation_status', v_existing.validation_status);
  end if;

  if v_session.id is null or v_session.status <> 'processing' then
    insert into automation_events (event_type, severity, source, correlation_id, details)
    values ('extraction.stale_attempt', 'warning', 'n8n', v_corr, jsonb_build_object('attempt_id', p_attempt_id));
    return jsonb_build_object('ok', false, 'outcome', 'stale_attempt');
  end if;

  v_built := build_extraction_input(v_session.id);
  v_hash := encode(sha256(convert_to((v_built -> 'input')::text, 'UTF8')), 'hex');
  if v_hash <> v_session.processing_input_hash then
    return apply_extraction_failure(v_session.id, 'failed', 'input_changed',
                                    'session messages changed while processing', p_provider, p_model,
                                    p_prompt_version, p_raw_output, v_corr);
  end if;

  -- Parse untrusted output. Only a single surrounding ``` fence is tolerated.
  if char_length(coalesce(p_raw_output, '')) > 200000 then
    return apply_extraction_failure(v_session.id, 'invalid_output', 'output_too_large', 'model output exceeds 200000 characters',
                                    p_provider, p_model, p_prompt_version, left(p_raw_output, 200000), v_corr);
  end if;
  v_text := btrim(coalesce(p_raw_output, ''));
  if v_text ~ '^```' then
    v_text := btrim(regexp_replace(regexp_replace(v_text, '^```[a-zA-Z]*', ''), '```$', ''));
  end if;
  begin
    v_json := v_text::jsonb;
  exception when others then
    v_json := null;
  end;
  if v_json is null or jsonb_typeof(v_json) <> 'object' or jsonb_typeof(v_json -> 'fields') <> 'object' then
    return apply_extraction_failure(v_session.id, 'invalid_output',
                                    case when v_json is null then 'malformed_json' else 'invalid_structure' end,
                                    'model output is not a JSON object with a fields object',
                                    p_provider, p_model, p_prompt_version, p_raw_output, v_corr);
  end if;

  v_val := validate_property_extraction(v_json, v_built -> 'input');
  v_vstatus := v_val ->> 'status';
  v_ids := array(select (jsonb_array_elements_text(v_built -> 'message_ids'))::uuid);

  select coalesce(jsonb_agg(med || jsonb_build_object('seq', (msg ->> 'seq')::int) order by (msg ->> 'seq')::int), '[]'::jsonb)
    into v_media
    from jsonb_array_elements(v_built -> 'input' -> 'messages') msg,
         jsonb_array_elements(coalesce(msg -> 'media', '[]'::jsonb)) med;

  v_data := jsonb_build_object(
    'schema_version', '1',
    'property',  v_val -> 'property',
    'fields',    v_json -> 'fields',
    'conflicts', coalesce(v_json -> 'conflicts', '[]'::jsonb),
    'notes',     coalesce(v_json -> 'notes', '[]'::jsonb),
    'languages', coalesce(v_json -> 'languages', '[]'::jsonb),
    'media',     v_media,
    -- provenance comes from the database, never from the model
    'source', jsonb_build_object('channel', 'whatsapp', 'agency_id', v_session.agency_id,
                                 'agent_id', v_session.agent_id, 'session_id', v_session.id,
                                 'input_message_ids', to_jsonb(v_ids)));

  insert into extraction_results (agency_id, session_id, provider, model, prompt_version, input_message_ids, status,
                                  extracted_data, confidence, validation_status, validation_errors, attempt_id,
                                  attempt_number, schema_version, input_hash, raw_output)
  values (v_session.agency_id, v_session.id, btrim(p_provider), btrim(p_model), p_prompt_version, v_ids, 'succeeded',
          v_data, jsonb_build_object('field_status', v_val -> 'statuses'), v_vstatus, v_val -> 'issues',
          p_attempt_id, v_session.processing_attempts, '1', v_hash, p_raw_output)
  returning id into v_result;

  v_next := case when v_vstatus = 'valid' then 'completed' else 'needs_review' end;
  update submission_sessions
     set status = v_next,
         closed_at = case when v_next = 'completed' then now() end,
         processing_attempt_id = null, processing_started_at = null, processing_input_hash = null,
         last_error = null
   where id = v_session.id;

  update whatsapp_messages set processing_status = 'processed'
   where id = any (v_ids) and processing_status in ('buffered', 'processing');

  v_event := case v_vstatus when 'valid' then 'extraction.succeeded' when 'incomplete' then 'extraction.incomplete'
                            when 'conflicting' then 'extraction.conflicted' else 'extraction.invalid' end;
  insert into automation_events (agency_id, event_type, severity, source, session_id, correlation_id, details)
  values (v_session.agency_id, v_event, case when v_vstatus = 'invalid' then 'warning' else 'info' end, 'n8n',
          v_session.id, v_corr,
          jsonb_build_object('attempt_id', p_attempt_id, 'attempt_number', v_session.processing_attempts,
                             'extraction_result_id', v_result, 'validation_status', v_vstatus,
                             'error_count', (select count(*) from jsonb_array_elements(v_val -> 'issues') i where i ->> 'severity' = 'error'),
                             'review_count', (select count(*) from jsonb_array_elements(v_val -> 'issues') i where i ->> 'severity' = 'review'),
                             'warning_count', (select count(*) from jsonb_array_elements(v_val -> 'issues') i where i ->> 'severity' = 'warning'),
                             'provider', btrim(p_provider), 'model', btrim(p_model), 'prompt_version', p_prompt_version));

  return jsonb_build_object('ok', true, 'outcome', 'recorded', 'extraction_result_id', v_result,
                            'validation_status', v_vstatus, 'session_status', v_next);
end;
$$;

comment on function public.record_extraction_result(uuid, text, text, text, text, text) is
  'Records the model output of a claimed attempt exactly once (unique attempt_id): parses and validates it '
  'deterministically, appends an extraction_results row, moves the session to completed (valid) or needs_review. '
  'Malformed output is a retryable failure. Never touches properties.';

-- ---------------------------------------------------------- record failure
create function public.record_extraction_failure(p_attempt_id uuid, p_error_code text, p_error_message text,
                                                 p_provider text default null, p_model text default null,
                                                 p_prompt_version text default null, p_correlation_id text default null)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_session  submission_sessions%rowtype;
  v_existing extraction_results%rowtype;
begin
  if p_attempt_id is null then
    return jsonb_build_object('ok', false, 'outcome', 'invalid_request');
  end if;

  select * into v_session from submission_sessions where processing_attempt_id = p_attempt_id for update;

  select * into v_existing from extraction_results where attempt_id = p_attempt_id;
  if v_existing.id is not null then
    return jsonb_build_object('ok', true, 'outcome', 'duplicate', 'extraction_result_id', v_existing.id,
                              'status', v_existing.status);
  end if;

  if v_session.id is null then
    insert into automation_events (event_type, severity, source, correlation_id, details)
    values ('extraction.stale_attempt', 'warning', 'n8n', left(p_correlation_id, 200),
            jsonb_build_object('attempt_id', p_attempt_id, 'reported_error', left(p_error_code, 40)));
    return jsonb_build_object('ok', false, 'outcome', 'stale_attempt');
  end if;

  return apply_extraction_failure(v_session.id, 'failed', p_error_code, p_error_message, p_provider, p_model,
                                  p_prompt_version, null, p_correlation_id);
end;
$$;

-- ------------------------------------------------------------ reprocessing
create function public.request_session_reprocessing(p_session_id uuid, p_reason text default null)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_session submission_sessions%rowtype;
begin
  select * into v_session from submission_sessions where id = p_session_id for update;
  if v_session.id is null or v_session.status not in ('completed', 'needs_review', 'failed') then
    return jsonb_build_object('ok', false, 'outcome', 'not_allowed', 'status', v_session.status);
  end if;

  update submission_sessions
     set status = 'ready', closed_at = null, process_after = now(), processing_attempts = 0, last_error = null
   where id = v_session.id;
  update whatsapp_messages set processing_status = 'buffered'
   where session_id = v_session.id and command is null and processing_status in ('processed', 'failed');

  insert into automation_events (agency_id, event_type, severity, source, session_id, details)
  values (v_session.agency_id, 'session.reprocess_requested', 'info', 'admin', v_session.id,
          jsonb_build_object('previous_status', v_session.status, 'reason', left(p_reason, 200)));

  return jsonb_build_object('ok', true, 'outcome', 'queued', 'previous_status', v_session.status);
end;
$$;

comment on function public.request_session_reprocessing(uuid, text) is
  'Intentional reprocessing: completed | needs_review | failed -> ready. The next claim creates a new attempt id, '
  'so a new extraction_results row is appended; earlier results are never modified.';

-- ------------------------------------------------------------------ grants
do $grants$
declare
  f text;
begin
  foreach f in array array[
    'public.extraction_issue(text, text, text, text)',
    'public.extraction_evidence_text(text)',
    'public.redact_error_text(text)',
    'public.build_extraction_input(uuid)',
    'public.validate_property_extraction(jsonb, jsonb)',
    'public.claim_submission_session(text)',
    'public.apply_extraction_failure(uuid, text, text, text, text, text, text, text, text)',
    'public.record_extraction_result(uuid, text, text, text, text, text)',
    'public.record_extraction_failure(uuid, text, text, text, text, text, text)',
    'public.request_session_reprocessing(uuid, text)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end
$grants$;
