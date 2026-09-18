-- =============================================================================
-- Phase 6 — property drafts from validated extractions (create-only, review required)
--
--   properties_automation_insert_guard   automation-created rows can only be INSERTed as draft / pending / whatsapp
--   submission_sessions state machine    + completed -> needs_review (generation rejected / needs routing attention)
--   property_draft_title(property)       deterministic title from validated fields
--   property_title_supported(t, p)       an AI title is used only if every word is backed by validated fields
--   property_slug_base(title)            URL-safe ASCII slug base
--   generate_property_draft(extraction)  atomic, idempotent draft creation from ONE valid extraction result
--   generate_pending_property_drafts()   recovery sweep for valid extractions that have no draft yet
--
-- Guarantees: never sets listing_status <> 'draft', never sets review_status <> 'pending', never touches
-- property_images, never updates an existing property (UPDATE is deferred), never reads ownership from AI output.
-- Rollback: docs/rebuild/phase-06-property-draft-generation.md, section "Rollback".
-- =============================================================================

-- --------------------------------------------------- automation insert guard
create function public.properties_automation_insert_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.created_from_session_id is not null
     and (new.listing_status <> 'draft'
          or new.review_status is distinct from 'pending'
          or new.source is distinct from 'whatsapp'
          or new.published_at is not null) then
    raise exception 'automation-created properties must be inserted as draft, pending review, source whatsapp'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke execute on function public.properties_automation_insert_guard() from public, anon, authenticated;

create trigger properties_automation_insert_guard_trg
  before insert on public.properties
  for each row execute function public.properties_automation_insert_guard();

comment on column public.properties.created_from_session_id is
  'Submission session that created this property (automation). Unique: one property per session; replaying a session '
  'or its extraction can never create a second property. Automation-created rows start as draft / pending review.';

-- ------------------------------------------------ session state machine (+1 edge)
create or replace function public.submission_sessions_status_transition()
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
    or (old.status = 'completed'    and new.status in ('ready', 'needs_review'))
    or (old.status = 'failed'       and new.status = 'ready')
  ) then
    raise exception 'invalid submission session transition: % -> %', old.status, new.status
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------- titles
create function public.property_draft_title(p jsonb)
returns text
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  with v as (
    select p ->> 'property_type' as type,
           p ->> 'intent' as intent,
           nullif(btrim(p ->> 'city'), '') as city,
           nullif(btrim(p ->> 'district'), '') as district,
           (p ->> 'bedrooms')::numeric as bedrooms,
           (p ->> 'rooms')::numeric as rooms,
           (p ->> 'area_sqm')::numeric as area,
           (p ->> 'land_area_sqm')::numeric as land_area
  ),
  parts as (
    select v.*,
           case v.type
             when 'commercial' then 'commercial space'
             when 'retail' then 'retail space'
             when 'other' then 'property'
             else v.type
           end as type_label,
           case
             when v.bedrooms is not null and v.type not in ('land', 'garage', 'warehouse')
               then trim_scale(v.bedrooms)::text || '-bedroom '
             when v.rooms is not null and v.type not in ('land', 'garage', 'warehouse')
               then trim_scale(v.rooms)::text || '-room '
             when v.type = 'land' and v.land_area is not null
               then case when v.land_area = trunc(v.land_area) then to_char(v.land_area, 'FM999,999,999,990')
                         else trim_scale(v.land_area)::text end || ' m² '
             when v.type in ('commercial', 'office', 'retail', 'warehouse', 'garage') and v.area is not null
               then case when v.area = trunc(v.area) then to_char(v.area, 'FM999,999,990')
                         else trim_scale(v.area)::text end || ' m² '
             else ''
           end as detail
    from v
  )
  select case
           when type is null or intent is null or city is null then null
           else left(
             upper(left(detail || type_label, 1)) || substr(detail || type_label, 2)
             || ' for ' || case intent when 'buy' then 'sale' else 'rent' end
             || ' in ' || concat_ws(', ', district, city),
             160)
         end
  from parts;
$$;

comment on function public.property_draft_title(jsonb) is
  'Deterministic draft title from validated property fields: "[N-bedroom |N-room |<area> m² ]<type> for sale|rent in '
  '[<district>, ]<city>". Returns null unless intent, property_type and city are known.';

create function public.property_title_supported(p_title text, p jsonb)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, pg_temp
as $$
declare
  v_allowed text[];
  v_token   text;
  v_type    text := p ->> 'property_type';
  v_numbers text[];
begin
  if p_title is null or btrim(p_title) = '' or char_length(p_title) > 160 or v_type is null then
    return false;
  end if;

  -- numbers the title may mention: only validated numeric facts
  select coalesce(array_agg(trim_scale((p ->> k)::numeric)::text), '{}') into v_numbers
    from unnest(array['rooms', 'bedrooms', 'bathrooms', 'floor', 'total_floors', 'area_sqm', 'land_area_sqm', 'year_built']) k
   where p ? k;

  v_allowed := array['a', 'an', 'the', 'in', 'at', 'on', 'with', 'and', 'of', 'near', 'for',
                     'room', 'rooms', 'bedroom', 'bedrooms', 'bathroom', 'bathrooms', 'sqm', 'm', 'm2', 'm²', '²',
                     'floor', 'storey', 'st', 'nd', 'rd', 'th',
                     v_type, v_type || 's', 'space', 'property', 'plot']
               || case p ->> 'intent' when 'buy' then array['sale', 'sell', 'selling']
                                      when 'rent' then array['rent', 'rental', 'lease'] else array[]::text[] end
               || v_numbers
               || coalesce(regexp_split_to_array(lower(p ->> 'city'), '[^[:alnum:]]+'), '{}')
               || coalesce(regexp_split_to_array(lower(p ->> 'district'), '[^[:alnum:]]+'), '{}')
               || coalesce((select array_agg(w) from jsonb_array_elements_text(coalesce(p -> 'features', '[]')) f,
                                   regexp_split_to_table(f, '_') w), '{}');

  -- the title must name the property type ...
  if lower(p_title) !~ ('\m' || v_type) then
    return false;
  end if;

  -- ... and every word must be backed by the list above
  for v_token in select t from regexp_split_to_table(lower(p_title), '[^[:alnum:]²]+') t where t <> '' loop
    if v_token <> all (v_allowed) then
      return false;
    end if;
  end loop;
  return true;
end;
$$;

comment on function public.property_title_supported(text, jsonb) is
  'True only when the AI title names the property type and every word in it is either a small connector word, the '
  'validated property type/intent/city/district/feature words, a unit word, or a validated number. Anything else '
  '(marketing adjectives, unsupported facts, wrong intent) rejects the AI title.';

create function public.property_slug_base(p_title text)
returns text
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select coalesce(nullif(
           regexp_replace(
             left(btrim(regexp_replace(replace(lower(coalesce(p_title, '')), 'm²', 'm2'), '[^a-z0-9]+', '-', 'g'), '-'), 80),
             '-+$', ''),
           ''), 'property');
$$;

comment on function public.property_slug_base(text) is
  'URL-safe slug base (a-z, 0-9, single hyphens, <= 80 chars) derived from the deterministic title.';

-- ------------------------------------------------------- draft generation
create function public.generate_property_draft(p_extraction_result_id uuid, p_correlation_id text default null)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  c_max_failures constant integer := 3;
  v_corr       text := left(nullif(btrim(p_correlation_id), ''), 200);
  v_er         extraction_results%rowtype;
  v_session    submission_sessions%rowtype;
  v_existing   properties%rowtype;
  v_agent      agents%rowtype;
  v_p          jsonb;
  v_reason     text;
  v_gen_title  text;
  v_ai_title   text;
  v_title      text;
  v_title_src  text;
  v_slug_base  text;
  v_slug       text;
  v_n          integer;
  v_id         uuid;
  v_features   text[];
  v_constraint text;
  v_sqlstate   text;
  v_message    text;
  v_failures   integer;
begin
  if p_extraction_result_id is null then
    return jsonb_build_object('ok', false, 'outcome', 'rejected', 'reason', 'invalid_request');
  end if;

  select * into v_er from extraction_results where id = p_extraction_result_id;
  if v_er.id is null then
    return jsonb_build_object('ok', false, 'outcome', 'rejected', 'reason', 'extraction_not_found');
  end if;

  -- One generation at a time per session: everything below runs under this row lock.
  select * into v_session from submission_sessions where id = v_er.session_id for update;

  -- ---------------------------------------------------------- idempotency
  select * into v_existing from properties where created_from_session_id = v_session.id;
  if v_existing.id is not null then
    if v_er.property_id = v_existing.id then
      insert into automation_events (agency_id, event_type, severity, source, session_id, property_id, correlation_id, details)
      values (v_session.agency_id, 'property.generation_duplicate', 'info', 'n8n', v_session.id, v_existing.id, v_corr,
              jsonb_build_object('extraction_result_id', v_er.id, 'attempt_id', v_er.attempt_id));
      return jsonb_build_object('ok', true, 'outcome', 'duplicate', 'property_id', v_existing.id, 'slug', v_existing.slug,
                                'listing_status', v_existing.listing_status, 'review_status', v_existing.review_status);
    end if;

    -- Another extraction of a session that already produced a draft: that would be an update. Deferred.
    insert into automation_events (agency_id, event_type, severity, source, session_id, property_id, correlation_id, details)
    values (v_session.agency_id, 'property.update_rejected', 'warning', 'n8n', v_session.id, v_existing.id, v_corr,
            jsonb_build_object('extraction_result_id', v_er.id, 'attempt_id', v_er.attempt_id,
                               'reason', 'update_not_supported'));
    if v_session.status = 'completed' then
      update submission_sessions set status = 'needs_review', closed_at = null, last_error = 'property_update_not_supported'
       where id = v_session.id;
    end if;
    return jsonb_build_object('ok', false, 'outcome', 'rejected', 'reason', 'update_not_supported',
                              'property_id', v_existing.id);
  end if;

  -- ---------------------------------------------------------- eligibility
  v_reason := case
    when v_er.status <> 'succeeded' then 'extraction_not_succeeded'
    when v_er.validation_status is distinct from 'valid' then 'extraction_not_valid'
    when v_session.status <> 'completed' then 'session_not_completed'
    when exists (select 1 from extraction_results x
                  where x.session_id = v_session.id and x.id <> v_er.id and x.created_at >= v_er.created_at)
      then 'stale_extraction'
    when v_er.property_id is not null or v_session.property_id is not null then 'already_linked'
    when v_er.extracted_data -> 'source' ->> 'session_id' is distinct from v_session.id::text
      or v_er.agency_id <> v_session.agency_id then 'provenance_mismatch'
  end;
  if v_reason is not null then
    insert into automation_events (agency_id, event_type, severity, source, session_id, correlation_id, details)
    values (v_session.agency_id, 'property.generation_rejected', 'info', 'n8n', v_session.id, v_corr,
            jsonb_build_object('extraction_result_id', v_er.id, 'attempt_id', v_er.attempt_id, 'reason', v_reason,
                               'validation_status', v_er.validation_status, 'session_status', v_session.status));
    return jsonb_build_object('ok', false, 'outcome', 'rejected', 'reason', v_reason);
  end if;

  -- ---------------------------------------------------------- ownership (never from AI output)
  select * into v_agent from agents where id = v_session.agent_id;
  if v_agent.id is null or not v_agent.is_active or v_agent.agency_id <> v_session.agency_id
     or not exists (select 1 from agencies a where a.id = v_session.agency_id) then
    insert into automation_events (agency_id, event_type, severity, source, session_id, correlation_id, details)
    values (v_session.agency_id, 'property.ownership_failed', 'warning', 'n8n', v_session.id, v_corr,
            jsonb_build_object('extraction_result_id', v_er.id, 'attempt_id', v_er.attempt_id,
                               'reason', case when v_agent.id is null then 'agent_missing'
                                              when not v_agent.is_active then 'agent_inactive'
                                              else 'agency_mismatch' end));
    update submission_sessions set status = 'needs_review', closed_at = null, last_error = 'property_ownership_failed'
     where id = v_session.id;
    return jsonb_build_object('ok', false, 'outcome', 'rejected', 'reason', 'ownership_failed');
  end if;

  -- ---------------------------------------------------------- mapping input: validated values only
  v_p := v_er.extracted_data -> 'property';
  if jsonb_typeof(v_p) <> 'object'
     or not (v_p ? 'intent' and v_p ? 'property_type' and v_p ? 'city' and v_p ? 'price' and v_p ? 'currency') then
    insert into automation_events (agency_id, event_type, severity, source, session_id, correlation_id, details)
    values (v_session.agency_id, 'property.generation_rejected', 'warning', 'n8n', v_session.id, v_corr,
            jsonb_build_object('extraction_result_id', v_er.id, 'attempt_id', v_er.attempt_id,
                               'reason', 'missing_critical_field'));
    return jsonb_build_object('ok', false, 'outcome', 'rejected', 'reason', 'missing_critical_field');
  end if;

  insert into automation_events (agency_id, event_type, severity, source, session_id, correlation_id, details)
  values (v_session.agency_id, 'property.generation_started', 'info', 'n8n', v_session.id, v_corr,
          jsonb_build_object('extraction_result_id', v_er.id, 'attempt_id', v_er.attempt_id));

  begin
    -- title: deterministic unless the AI title is fully backed by validated fields
    v_gen_title := property_draft_title(v_p);
    v_ai_title  := nullif(btrim(v_p ->> 'title'), '');
    if v_ai_title is not null and property_title_supported(v_ai_title, v_p) then
      v_title := v_ai_title;
      v_title_src := 'ai_validated';
    else
      v_title := v_gen_title;
      v_title_src := case when v_ai_title is null then 'generated' else 'generated_ai_rejected' end;
    end if;

    select coalesce(array_agg(f order by o), '{}') into v_features
      from jsonb_array_elements_text(coalesce(v_p -> 'features', '[]')) with ordinality as t(f, o);

    -- slug: from the deterministic title (independent of AI wording); first free of base, base-2, base-3, ...
    v_slug_base := property_slug_base(v_gen_title);
    v_n := 1;
    loop
      v_slug := case when v_n = 1 then v_slug_base
                     else regexp_replace(left(v_slug_base, 80 - char_length(v_n::text) - 1), '-+$', '') || '-' || v_n end;
      if not exists (select 1 from properties where slug = v_slug) then
        begin
          insert into properties (
            slug, title, description, intent, property_type, country, city, district, address,
            latitude, longitude, price, currency, price_negotiable, price_period,
            area_sqm, land_area_sqm, rooms, bedrooms, bathrooms, floor, total_floors, year_built, features,
            listing_status, review_status, source, agency_id, agent_id, created_from_session_id, metadata)
          values (
            v_slug, v_title, v_p ->> 'description', v_p ->> 'intent', v_p ->> 'property_type', v_p ->> 'country',
            v_p ->> 'city', v_p ->> 'district', v_p ->> 'address',
            (v_p ->> 'latitude')::numeric, (v_p ->> 'longitude')::numeric,
            (v_p ->> 'price')::numeric, v_p ->> 'currency', (v_p ->> 'price_negotiable')::boolean,
            case when v_p ->> 'intent' = 'rent' then v_p ->> 'price_period' end,
            (v_p ->> 'area_sqm')::numeric, (v_p ->> 'land_area_sqm')::numeric,
            (v_p ->> 'rooms')::smallint, (v_p ->> 'bedrooms')::smallint, (v_p ->> 'bathrooms')::smallint,
            (v_p ->> 'floor')::smallint, (v_p ->> 'total_floors')::smallint, (v_p ->> 'year_built')::smallint,
            v_features,
            'draft', 'pending', 'whatsapp', v_session.agency_id, v_session.agent_id, v_session.id,
            jsonb_build_object('automation', jsonb_build_object(
              'generator', 'property-draft-v1',
              'review_required', true,
              'extraction_result_id', v_er.id,
              'extraction_attempt_id', v_er.attempt_id,
              'prompt_version', v_er.prompt_version,
              'model', v_er.model,
              'title_source', v_title_src)))
          returning id into v_id;
          exit;
        exception when unique_violation then
          get stacked diagnostics v_constraint = constraint_name;
          if v_constraint is distinct from 'properties_slug_key' then
            raise;
          end if;
          -- a concurrent insert took this slug: try the next suffix
        end;
      end if;
      v_n := v_n + 1;
      if v_n > 1000 then
        raise exception 'no free slug for base %', v_slug_base using errcode = 'check_violation';
      end if;
    end loop;

    update extraction_results set property_id = v_id where id = v_er.id;
    update submission_sessions set property_id = v_id, kind = 'create' where id = v_session.id;

    insert into automation_events (agency_id, event_type, severity, source, session_id, property_id, correlation_id, details)
    values (v_session.agency_id, 'property.draft_created', 'info', 'n8n', v_session.id, v_id, v_corr,
            jsonb_build_object('extraction_result_id', v_er.id, 'attempt_id', v_er.attempt_id, 'slug', v_slug,
                               'title_source', v_title_src, 'listing_status', 'draft', 'review_status', 'pending'));
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
    -- Transient problems (timeouts, cancellations, lock/serialization conflicts, connection issues) propagate:
    -- nothing is written and the caller simply retries.
    if v_sqlstate in ('57014', '57P01', '40001', '40P01', '55P03', '53300') or v_sqlstate like '08%' then
      raise;
    end if;

    insert into automation_events (agency_id, event_type, severity, source, session_id, correlation_id, details)
    values (v_session.agency_id, 'property.generation_failed', 'error', 'n8n', v_session.id, v_corr,
            jsonb_build_object('extraction_result_id', v_er.id, 'attempt_id', v_er.attempt_id,
                               'sqlstate', v_sqlstate, 'error', redact_error_text(v_message)));

    select count(*) into v_failures from automation_events
     where event_type = 'property.generation_failed' and session_id = v_session.id
       and details ->> 'extraction_result_id' = v_er.id::text;

    if v_failures >= c_max_failures then
      update submission_sessions set status = 'needs_review', closed_at = null, last_error = 'property_generation_failed'
       where id = v_session.id;
      insert into automation_events (agency_id, event_type, severity, source, session_id, correlation_id, details)
      values (v_session.agency_id, 'property.generation_abandoned', 'error', 'n8n', v_session.id, v_corr,
              jsonb_build_object('extraction_result_id', v_er.id, 'failures', v_failures));
    end if;

    return jsonb_build_object('ok', false, 'outcome', 'failed', 'retryable', v_failures < c_max_failures,
                              'failures', v_failures);
  end;

  return jsonb_build_object('ok', true, 'outcome', 'created', 'property_id', v_id, 'slug', v_slug,
                            'listing_status', 'draft', 'review_status', 'pending', 'title_source', v_title_src);
end;
$$;

comment on function public.generate_property_draft(uuid, text) is
  'Creates ONE non-public property draft (draft / pending review / source whatsapp) from a valid, current extraction '
  'result of a completed session. Ownership from session -> active agent -> agency. Idempotent: one property per '
  'session (unique created_from_session_id, session row lock). Create-only: a second extraction for a session that '
  'already has a draft is rejected (update deferred). Returns only ids/status.';

create function public.generate_pending_property_drafts(p_limit integer default 5, p_correlation_id text default null)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  r         record;
  v_results jsonb := '[]'::jsonb;
begin
  for r in
    select e.id
      from extraction_results e
      join submission_sessions s on s.id = e.session_id
     where e.status = 'succeeded'
       and e.validation_status = 'valid'
       and e.property_id is null
       and s.status = 'completed'
       and s.property_id is null
       and not exists (select 1 from extraction_results x
                        where x.session_id = e.session_id and x.id <> e.id and x.created_at >= e.created_at)
     order by e.created_at, e.id
     limit greatest(1, least(coalesce(p_limit, 5), 50))
  loop
    v_results := v_results || jsonb_build_array(generate_property_draft(r.id, p_correlation_id)
                                                || jsonb_build_object('extraction_result_id', r.id));
  end loop;
  return jsonb_build_object('ok', true, 'processed', jsonb_array_length(v_results), 'results', v_results);
end;
$$;

comment on function public.generate_pending_property_drafts(integer, text) is
  'Recovery sweep: generates drafts for valid, current extraction results of completed sessions that have none yet '
  '(e.g. the worker stopped after recording the result). Uses generate_property_draft, so it is idempotent.';

do $grants$
declare
  f text;
begin
  foreach f in array array[
    'public.property_draft_title(jsonb)',
    'public.property_title_supported(text, jsonb)',
    'public.property_slug_base(text)',
    'public.generate_property_draft(uuid, text)',
    'public.generate_pending_property_drafts(integer, text)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end
$grants$;
