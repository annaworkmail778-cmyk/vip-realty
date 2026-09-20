-- Phase 10 (2/2) — controlled listing editing, gallery arrangement, inactive agencies.
--
-- * admin_update_property: the only admin path to change listing CONTENT. Whitelisted fields, typed, trimmed,
--   bounded; optimistic concurrency (state_version); idempotent (no change -> 'unchanged'); audited.
--   draft pending -> stays pending · draft approved/rejected -> back to pending (re-review) · published -> stays
--   published only if the edit introduces NO new publication blocker (checked by property_publication_check inside the
--   same transaction, otherwise rolled back) · sold/rented/archived and legacy rows (no agency) are not editable.
--   Ownership, provenance, slug, lifecycle, review and automation columns can never be changed through it.
-- * admin_arrange_property_images: reorder a listing's own gallery and choose its cover. Exactly the listing's image
--   set must be sent; nothing can be moved between listings (provenance stays immutable, Phase 7 trigger).
-- * property_publication_check: + 'agency_inactive'; an extraction conflict on a field an admin has since edited is
--   treated as resolved (the human value replaces both conflicting AI candidates).
-- * generate_property_draft / ingest_whatsapp_message: an INACTIVE agency's messages are stored but unresolved
--   (reason agency_inactive) and no draft is generated for it — no property mutation through an inactive agency.
-- * admin_operations_status: + site profile readiness, inactive agencies/agents.
--
-- NOTE ON HOW THIS WAS APPLIED to the live project: this file carries the full definitions. The live database was
-- patched by re-applying the same, anchor-asserted text edits to its deployed definitions (migration
-- 20260919215136_listing_editing), then every function body's md5 was compared with this file. A fresh database
-- created from these migration files ends up with byte-identical definitions.

-- ------------------------------------------------------------------ listing content editing
create or replace function public.admin_update_property(
  p_property_id uuid, p_expected_version integer, p_changes jsonb, p_actor text default null)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  c_text    constant text[] := array['title', 'description', 'city', 'district', 'address'];
  c_code    constant text[] := array['intent', 'property_type', 'currency', 'price_period', 'country'];
  c_numeric constant text[] := array['price', 'area_sqm', 'land_area_sqm'];
  c_small   constant text[] := array['rooms', 'bedrooms', 'bathrooms', 'floor', 'total_floors', 'year_built'];
  c_limit   constant jsonb := '{"title": 160, "description": 5000, "city": 80, "district": 80, "address": 200}';
  v_actor   text := admin_actor(p_actor);
  p         properties%rowtype;
  n         properties%rowtype;
  v_clean   jsonb := '{}'::jsonb;
  v_features text[];
  k         text;
  v         jsonb;
  s         text;
  v_changed text[] := '{}';
  v_diff    jsonb := '{}'::jsonb;
  v_before  text[] := '{}';
  v_after   text[] := '{}';
  v_new_blockers text[] := '{}';
  v_reset   boolean := false;
  v_constraint text;
begin
  if p_property_id is null or p_changes is null or jsonb_typeof(p_changes) <> 'object' then
    return jsonb_build_object('ok', false, 'outcome', 'invalid_request', 'reason', 'changes_not_object');
  end if;

  -- ---------------------------------------------------------------- whitelist, types, normalisation
  for k, v in select * from jsonb_each(p_changes) loop
    if k = any (c_text) then
      if jsonb_typeof(v) not in ('string', 'null') then
        return jsonb_build_object('ok', false, 'outcome', 'invalid_value', 'field', k, 'reason', 'type');
      end if;
      s := nullif(btrim(replace(v #>> '{}', E'\r\n', E'\n')), '');
      if s ~ (case when k = 'description' then E'[\\x01-\\x08\\x0b\\x0c\\x0e-\\x1f\\x7f]' else '[[:cntrl:]]' end) then
        return jsonb_build_object('ok', false, 'outcome', 'invalid_value', 'field', k, 'reason', 'control_characters');
      end if;
      if char_length(s) > (c_limit ->> k)::int then
        return jsonb_build_object('ok', false, 'outcome', 'invalid_value', 'field', k, 'reason', 'too_long',
                                  'max', (c_limit ->> k)::int);
      end if;
      v_clean := v_clean || jsonb_build_object(k, s);
    elsif k = any (c_code) then
      if jsonb_typeof(v) not in ('string', 'null') then
        return jsonb_build_object('ok', false, 'outcome', 'invalid_value', 'field', k, 'reason', 'type');
      end if;
      s := nullif(btrim(v #>> '{}'), '');
      if k = 'country' then s := upper(s); end if;
      v_clean := v_clean || jsonb_build_object(k, s);
    elsif k = any (c_numeric) or k = any (c_small) then
      if jsonb_typeof(v) not in ('number', 'null') then
        return jsonb_build_object('ok', false, 'outcome', 'invalid_value', 'field', k, 'reason', 'type');
      end if;
      if k = any (c_small) and jsonb_typeof(v) = 'number'
         and ((v #>> '{}')::numeric <> trunc((v #>> '{}')::numeric) or abs((v #>> '{}')::numeric) > 32767) then
        return jsonb_build_object('ok', false, 'outcome', 'invalid_value', 'field', k, 'reason', 'whole_number');
      end if;
      if k = any (c_numeric) and jsonb_typeof(v) = 'number' and abs((v #>> '{}')::numeric) >= 1e13 then
        return jsonb_build_object('ok', false, 'outcome', 'invalid_value', 'field', k, 'reason', 'out_of_range');
      end if;
      v_clean := v_clean || jsonb_build_object(k, v);
    elsif k = 'price_negotiable' then
      if jsonb_typeof(v) not in ('boolean', 'null') then
        return jsonb_build_object('ok', false, 'outcome', 'invalid_value', 'field', k, 'reason', 'type');
      end if;
      v_clean := v_clean || jsonb_build_object(k, v);
    elsif k = 'features' then
      if jsonb_typeof(v) <> 'array' or exists (select 1 from jsonb_array_elements(v) e where jsonb_typeof(e) <> 'string') then
        return jsonb_build_object('ok', false, 'outcome', 'invalid_value', 'field', k, 'reason', 'type');
      end if;
      select coalesce(array_agg(distinct f order by f), '{}') into v_features
        from (select lower(btrim(e)) f from jsonb_array_elements_text(v) e) x where f <> '';
      if cardinality(v_features) > 30 or exists (select 1 from unnest(v_features) f where f !~ '^[a-z0-9_]{1,40}$') then
        return jsonb_build_object('ok', false, 'outcome', 'invalid_value', 'field', k, 'reason', 'format');
      end if;
    else
      -- ownership, provenance, slug, lifecycle, review, versions, metadata, coordinates, flags: never editable here
      return jsonb_build_object('ok', false, 'outcome', 'invalid_request', 'reason', 'field_not_editable', 'field', k);
    end if;
  end loop;

  select * into p from properties where id = p_property_id for update;
  if p.id is null then
    return jsonb_build_object('ok', false, 'outcome', 'not_found');
  end if;
  if p.agency_id is null then
    return jsonb_build_object('ok', false, 'outcome', 'not_editable', 'reason', 'no_agency');
  end if;
  if p.listing_status not in ('draft', 'published') then
    return jsonb_build_object('ok', false, 'outcome', 'invalid_state', 'listing_status', p.listing_status);
  end if;

  n := jsonb_populate_record(p, v_clean);
  if v_features is not null then n.features := v_features; end if;

  select coalesce(array_agg(key order by key), '{}') into v_changed
    from jsonb_each(to_jsonb(n)) x
   where (key in (select jsonb_object_keys(v_clean)) or (key = 'features' and v_features is not null))
     and x.value is distinct from to_jsonb(p) -> key;

  if cardinality(v_changed) = 0 then
    return jsonb_build_object('ok', true, 'outcome', 'unchanged', 'state_version', p.state_version,
                              'listing_status', p.listing_status, 'review_status', p.review_status);
  end if;
  if p_expected_version is distinct from p.state_version then
    return jsonb_build_object('ok', false, 'outcome', 'stale', 'state_version', p.state_version,
                              'listing_status', p.listing_status);
  end if;

  if p.listing_status = 'published' then
    select coalesce(array_agg(b), '{}') into v_before
      from jsonb_array_elements_text(property_publication_check(p.id) -> 'blockers') b where b <> 'already_published';
  end if;
  v_reset := p.listing_status = 'draft' and p.review_status in ('approved', 'rejected');

  select jsonb_object_agg(c, case when c = 'description'
                                  then jsonb_build_object('from_length', char_length(p.description),
                                                          'to_length', char_length(n.description))
                                  else jsonb_build_object('from', to_jsonb(p) -> c, 'to', to_jsonb(n) -> c) end)
    into v_diff from unnest(v_changed) c;

  begin
    update properties
       set title = n.title, description = n.description, intent = n.intent, property_type = n.property_type,
           country = n.country, city = n.city, district = n.district, address = n.address, price = n.price,
           currency = n.currency, price_period = n.price_period, price_negotiable = n.price_negotiable,
           area_sqm = n.area_sqm, land_area_sqm = n.land_area_sqm, rooms = n.rooms, bedrooms = n.bedrooms,
           bathrooms = n.bathrooms, floor = n.floor, total_floors = n.total_floors, year_built = n.year_built,
           features = n.features,
           review_status = case when v_reset then 'pending' else review_status end,
           review_note   = case when v_reset then null else review_note end,
           reviewed_at   = case when v_reset then null else reviewed_at end,
           reviewed_by   = case when v_reset then null else reviewed_by end,
           metadata = jsonb_set(metadata, '{admin}',
                        coalesce(metadata -> 'admin', '{}'::jsonb)
                        || jsonb_build_object('edited_fields',
                             (select coalesce(jsonb_agg(distinct f order by f), '[]'::jsonb)
                                from (select jsonb_array_elements_text(coalesce(metadata -> 'admin' -> 'edited_fields',
                                                                                '[]'::jsonb)) f
                                      union select unnest(v_changed)) u),
                           'last_edited_at', now()))
     where id = p.id
    returning * into n;

    if p.listing_status = 'published' then
      select coalesce(array_agg(b), '{}') into v_after
        from jsonb_array_elements_text(property_publication_check(n.id) -> 'blockers') b where b <> 'already_published';
      select coalesce(array_agg(b), '{}') into v_new_blockers from unnest(v_after) b where not (b = any (v_before));
      if cardinality(v_new_blockers) > 0 then
        raise exception 'publication_blocked' using errcode = 'P0001';
      end if;
    end if;
  exception
    when check_violation or not_null_violation or numeric_value_out_of_range then
      get stacked diagnostics v_constraint = constraint_name;
      return jsonb_build_object('ok', false, 'outcome', 'invalid_value', 'field', admin_constraint_field(v_constraint),
                                'reason', 'constraint', 'constraint', v_constraint);
    when raise_exception then
      return jsonb_build_object('ok', false, 'outcome', 'blocked', 'blockers', to_jsonb(v_new_blockers),
                                'listing_status', p.listing_status, 'state_version', p.state_version);
  end;

  perform property_event(n, 'property.edited', 'info', 'admin', null,
    jsonb_build_object('actor', v_actor, 'fields', to_jsonb(v_changed), 'changes', v_diff,
                       'listing_status', n.listing_status,
                       'review_reset', case when v_reset then jsonb_build_object('from', p.review_status, 'to', 'pending') end));
  return jsonb_build_object('ok', true, 'outcome', 'updated', 'fields', to_jsonb(v_changed),
                            'state_version', n.state_version, 'listing_status', n.listing_status,
                            'review_status', n.review_status, 'review_reset', v_reset);
end;
$$;

-- ------------------------------------------------------------------ gallery order and cover
create or replace function public.admin_arrange_property_images(
  p_property_id uuid, p_expected_version integer, p_image_ids uuid[], p_primary_image_id uuid default null,
  p_actor text default null)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_actor   text := admin_actor(p_actor);
  p         properties%rowtype;
  v_current uuid[];
  v_primary uuid;
begin
  select * into p from properties where id = p_property_id for update;
  if p.id is null then
    return jsonb_build_object('ok', false, 'outcome', 'not_found');
  end if;
  if p.agency_id is null then
    return jsonb_build_object('ok', false, 'outcome', 'not_editable', 'reason', 'no_agency');
  end if;
  if p.listing_status not in ('draft', 'published') then
    return jsonb_build_object('ok', false, 'outcome', 'invalid_state', 'listing_status', p.listing_status);
  end if;

  select coalesce(array_agg(id order by sort_order), '{}') into v_current from property_images where property_id = p.id;
  select id into v_primary from property_images where property_id = p.id and is_primary;

  -- exactly this listing's images, each once; the cover must be one of them
  if p_image_ids is null or cardinality(p_image_ids) <> cardinality(v_current)
     or (select count(distinct x) from unnest(p_image_ids) x) <> cardinality(p_image_ids)
     or exists (select unnest(p_image_ids) except select unnest(v_current))
     or (p_primary_image_id is not null and not (p_primary_image_id = any (p_image_ids))) then
    return jsonb_build_object('ok', false, 'outcome', 'invalid_request', 'reason', 'image_mismatch');
  end if;

  if p_image_ids = v_current and p_primary_image_id is not distinct from v_primary then
    return jsonb_build_object('ok', true, 'outcome', 'unchanged', 'state_version', p.state_version);
  end if;
  if p_expected_version is distinct from p.state_version then
    return jsonb_build_object('ok', false, 'outcome', 'stale', 'state_version', p.state_version);
  end if;

  update property_images set is_primary = false where property_id = p.id and is_primary;
  update property_images i
     set sort_order = o.ord - 1, is_primary = (i.id is not distinct from p_primary_image_id)
    from unnest(p_image_ids) with ordinality as o(id, ord)
   where i.id = o.id and i.property_id = p.id;
  update properties set updated_at = now() where id = p.id returning * into p;   -- bumps state_version

  perform property_event(p, 'property.images_arranged', 'info', 'admin', null,
    jsonb_build_object('actor', v_actor, 'count', cardinality(p_image_ids),
                       'order_changed', p_image_ids <> v_current,
                       'cover_changed', p_primary_image_id is distinct from v_primary));
  return jsonb_build_object('ok', true, 'outcome', 'arranged', 'state_version', p.state_version);
end;
$$;

-- ------------------------------------------------------------------ publication check (+ agency_inactive, admin-resolved conflicts)
create or replace function public.property_publication_check(p_property_id uuid)
returns jsonb
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  p          properties%rowtype;
  g          agents%rowtype;
  v_er       extraction_results%rowtype;
  v_blockers text[] := '{}';
  v_warnings text[] := '{}';
  v_images   integer;
  v_pending  integer := 0;
begin
  select * into p from properties where id = p_property_id;
  if p.id is null then
    return jsonb_build_object('publishable', false, 'blockers', jsonb_build_array('not_found'));
  end if;

  if p.listing_status = 'published' then v_blockers := v_blockers || 'already_published'::text;
  elsif p.listing_status = 'archived' then v_blockers := v_blockers || 'archived'::text;
  end if;
  if p.agency_id is null then
    v_blockers := v_blockers || 'no_agency'::text;
  elsif not exists (select 1 from agencies a where a.id = p.agency_id) then
    v_blockers := v_blockers || 'agency_missing'::text;
  elsif not exists (select 1 from agencies a where a.id = p.agency_id and a.is_active) then
    v_blockers := v_blockers || 'agency_inactive'::text;
  end if;
  if p.agent_id is not null then
    select * into g from agents where id = p.agent_id;
    if g.id is null or g.agency_id is distinct from p.agency_id then v_blockers := v_blockers || 'agent_agency_mismatch'::text;
    elsif not g.is_active then v_blockers := v_blockers || 'agent_inactive'::text;
    end if;
  end if;
  if p.review_status is distinct from 'approved' then v_blockers := v_blockers || 'not_approved'::text; end if;
  if p.title is null then v_blockers := v_blockers || 'missing_title'::text; end if;
  if p.intent is null then v_blockers := v_blockers || 'missing_intent'::text; end if;
  if p.property_type is null then v_blockers := v_blockers || 'missing_property_type'::text; end if;
  if p.city is null then v_blockers := v_blockers || 'missing_city'::text; end if;
  if p.price is null then v_blockers := v_blockers || 'missing_price'::text; end if;
  if p.currency is null then v_blockers := v_blockers || 'missing_currency'::text; end if;

  if p.source = 'whatsapp' then
    select * into v_er from extraction_results where property_id = p.id order by created_at desc limit 1;
    if v_er.id is null or v_er.status <> 'succeeded' or v_er.validation_status is distinct from 'valid' then
      v_blockers := v_blockers || 'extraction_not_valid'::text;
    elsif exists (select 1 from jsonb_array_elements(coalesce(v_er.extracted_data -> 'conflicts', '[]'::jsonb)) c
                   where c ->> 'resolution' is distinct from 'latest_correction'
                     -- Phase 10: a field an admin has edited since is resolved by that human value
                     and not (coalesce(p.metadata -> 'admin' -> 'edited_fields', '[]'::jsonb) ? (c ->> 'field'))) then
      v_blockers := v_blockers || 'unresolved_conflict'::text;
    end if;
    if p.created_from_session_id is not null and v_er.id is not null and exists (
         select 1 from extraction_results x
          where x.session_id = p.created_from_session_id and x.created_at > v_er.created_at) then
      v_warnings := v_warnings || 'newer_extraction_not_applied'::text;
    end if;
    -- photos still on their way to this draft (they can only attach while it is a draft)
    select count(*) into v_pending
      from whatsapp_media wm
      join whatsapp_messages m on m.id = wm.message_id
     where m.session_id = p.created_from_session_id
       and (wm.download_status in ('received', 'downloading', 'downloaded', 'validating', 'attaching', 'uploaded')
            or (wm.download_status = 'validated'
                and coalesce((media_property_association(wm.id) ->> 'eligible')::boolean, false)));
    if v_pending > 0 then v_blockers := v_blockers || 'media_processing'::text; end if;
  end if;

  select count(*) into v_images from property_images where property_id = p.id;
  if v_images = 0 then v_warnings := v_warnings || 'no_images'::text; end if;

  return jsonb_build_object('publishable', cardinality(v_blockers) = 0, 'blockers', to_jsonb(v_blockers),
                            'warnings', to_jsonb(v_warnings), 'image_count', v_images, 'pending_media', v_pending,
                            'listing_status', p.listing_status, 'review_status', p.review_status,
                            'state_version', p.state_version);
end;
$$;

-- ------------------------------------------------------------------ draft generation (+ inactive agency)
create or replace function public.generate_property_draft(p_extraction_result_id uuid, p_correlation_id text default null)
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
     or not exists (select 1 from agencies a where a.id = v_session.agency_id and a.is_active) then
    insert into automation_events (agency_id, event_type, severity, source, session_id, correlation_id, details)
    values (v_session.agency_id, 'property.ownership_failed', 'warning', 'n8n', v_session.id, v_corr,
            jsonb_build_object('extraction_result_id', v_er.id, 'attempt_id', v_er.attempt_id,
                               'reason', case when v_agent.id is null then 'agent_missing'
                                              when not v_agent.is_active then 'agent_inactive'
                                              when v_agent.agency_id <> v_session.agency_id then 'agency_mismatch'
                                              when not exists (select 1 from agencies a
                                                                where a.id = v_session.agency_id) then 'agency_missing'
                                              when not exists (select 1 from agencies a
                                                                where a.id = v_session.agency_id and a.is_active)
                                                then 'agency_inactive'
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

-- ------------------------------------------------------------------ ingestion (+ inactive agency: stored, unresolved)
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
  v_status_cmd  jsonb;
  v_status_res  jsonb;
  v_agency_active boolean;
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
  select a.id, a.is_active into v_agency_id, v_agency_active
    from agencies a where a.whatsapp_phone_number_id = v_recipient;

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
      when not v_agency_active then 'agency_inactive'   -- Phase 10: stored, never processed
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
    -- Session commands (done/cancel) first; otherwise a deterministic listing status command (Phase 8, no AI).
    if v_agent_ok and v_type = 'text' and v_conv_type = 'direct' then
      v_command := whatsapp_command(v_body);
      if v_command is null then
        v_status_cmd := whatsapp_status_command(v_body);
        if v_status_cmd is not null then
          v_command := 'status_' || (v_status_cmd ->> 'action');
        end if;
      end if;
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

    if v_status_cmd is not null then
      -- ---------------------------------------------------- listing status command: never touches sessions
      v_status_res := apply_whatsapp_status_command(v_message_id, v_agent_id, v_agency_id, v_status_cmd, v_correlation);
      v_status := case when (v_status_res ->> 'applied')::boolean then 'processed' else 'ignored' end;
      update whatsapp_messages set processing_status = v_status where id = v_message_id;
      return jsonb_strip_nulls(jsonb_build_object(
        'ok', true, 'outcome', 'stored', 'message_id', v_message_id, 'session_created', false,
        'processing_status', v_status, 'command', v_command, 'status_command', v_status_res,
        'message_id_source', v_pmid_source));
    end if;

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

-- ------------------------------------------------------------------ operations status (+ site profile readiness)
create or replace function public.admin_operations_status()
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'generated_at', now(),

    -- Can the pipeline route anything at all? (Configuration readiness, not credentials.)
    'readiness', jsonb_build_object(
      'agencies', (select count(*) from agencies),
      'agencies_with_whatsapp_number', (select count(*) from agencies where whatsapp_phone_number_id is not null),
      'active_agents', (select count(*) from agents where is_active),
      'active_agents_with_identity', (select count(*) from agents
                                        where is_active and (whatsapp_user_id is not null or whatsapp_phone is not null)),
      'inactive_agencies', (select count(*) from agencies where not is_active),
      'inactive_agents', (select count(*) from agents where not is_active),
      -- Phase 10: the website's brand/contact source. Field NAMES only, never values.
      'site_profile', coalesce((select jsonb_build_object(
          'configured', true,
          'missing', to_jsonb(array_remove(array[
             case when a.display_name is null then 'display_name' end,
             case when a.public_phone is null then 'public_phone' end,
             case when a.public_whatsapp is null then 'public_whatsapp' end], null)),
          'placeholders', to_jsonb(array_remove(array[
             case when contact_is_placeholder(a.public_phone) then 'public_phone' end,
             case when contact_is_placeholder(a.public_whatsapp) then 'public_whatsapp' end,
             case when contact_is_placeholder(a.public_email) then 'public_email' end], null)))
        from agencies a where a.is_site_primary and a.is_active), jsonb_build_object('configured', false))
    ),

    'messages', jsonb_build_object(
      'last_received_at', (select max(received_at) from whatsapp_messages),
      'last_24h', (select count(*) from whatsapp_messages where received_at > now() - interval '24 hours'),
      'by_status', coalesce((select jsonb_object_agg(processing_status, n) from
                     (select processing_status, count(*) n from whatsapp_messages group by 1) s), '{}'::jsonb),
      'failed', (select count(*) from whatsapp_messages where processing_status = 'failed'),
      'unresolved_sender', (select count(*) from whatsapp_messages where processing_status = 'unresolved_sender')
    ),

    'sessions', jsonb_build_object(
      'by_status', coalesce((select jsonb_object_agg(status, n) from
                     (select status, count(*) n from submission_sessions group by 1) s), '{}'::jsonb),
      'ready_waiting_over_15m', (select count(*) from submission_sessions
                                  where status = 'ready' and last_message_at < now() - interval '15 minutes'),
      'processing_over_15m', (select count(*) from submission_sessions
                               where status = 'processing' and processing_started_at < now() - interval '15 minutes')
    ),

    'extractions', jsonb_build_object(
      'by_status', coalesce((select jsonb_object_agg(status, n) from
                     (select status, count(*) n from extraction_results group by 1) s), '{}'::jsonb),
      'failed_last_24h', (select count(*) from extraction_results
                           where status = 'failed' and created_at > now() - interval '24 hours')
    ),

    'media', jsonb_build_object(
      'by_status', coalesce((select jsonb_object_agg(download_status, n) from
                     (select download_status, count(*) n from whatsapp_media group by 1) s), '{}'::jsonb),
      'held', (select count(*) from whatsapp_media
                where download_status in ('validated', 'uploaded') and status_reason like 'held:%'),
      'expired_leases', (select count(*) from whatsapp_media where lease_expires_at < now()),
      'deadline_passed_unfinished', (select count(*) from whatsapp_media
                                      where download_deadline_at < now()
                                        and download_status in ('received', 'downloading'))
    ),

    'listings', jsonb_build_object(
      'drafts_pending_review', (select count(*) from properties
                                 where listing_status = 'draft' and coalesce(review_status, 'pending') = 'pending'),
      'approved_not_published', (select count(*) from properties
                                  where listing_status = 'draft' and review_status = 'approved'),
      'rejected', (select count(*) from properties where listing_status = 'draft' and review_status = 'rejected'),
      -- Pending drafts with no agency (the 6 legacy records) can never be published; counted separately so the page
      -- can exclude them from the review backlog.
      'drafts_without_agency', (select count(*) from properties
                                 where listing_status = 'draft' and agency_id is null
                                   and coalesce(review_status, 'pending') = 'pending'),
      'by_listing_status', coalesce((select jsonb_object_agg(listing_status, n) from
                             (select listing_status, count(*) n from properties group by 1) s), '{}'::jsonb),
      'publicly_visible', (select count(*) from published_property_listings)
    ),

    'inquiries', jsonb_build_object(
      'new', (select count(*) from inquiries where status = 'new'),
      'last_24h', (select count(*) from inquiries where created_at > now() - interval '24 hours')
    ),

    'status_commands_7d', jsonb_build_object(
      'applied', (select count(*) from automation_events
                   where event_type = 'property.status_changed' and created_at > now() - interval '7 days'),
      'rejected', (select count(*) from automation_events
                    where event_type = 'property.status_command_rejected' and created_at > now() - interval '7 days'),
      'duplicate', (select count(*) from automation_events
                     where event_type = 'property.status_command_duplicate' and created_at > now() - interval '7 days'),
      'ignored', (select count(*) from automation_events
                   where event_type = 'whatsapp.command_ignored' and created_at > now() - interval '7 days')
    ),

    'events', jsonb_build_object(
      'last_event_at', (select max(created_at) from automation_events),
      'last_24h_by_severity', coalesce((select jsonb_object_agg(severity, n) from
                                (select severity, count(*) n from automation_events
                                  where created_at > now() - interval '24 hours' group by 1) s), '{}'::jsonb),
      -- Recent warnings/errors: codes and ids only. `reason` is passed through only when it is a short machine code.
      'recent_problems', coalesce((select jsonb_agg(p order by p.created_at desc) from (
          select e.id, e.event_type, e.severity, e.source, e.created_at, e.session_id, e.property_id,
                 case when e.details->>'reason' ~ '^[a-z0-9_:.\-]{1,64}$' then e.details->>'reason' end as reason
            from automation_events e
           where e.severity in ('warning', 'error') and e.created_at > now() - interval '7 days'
           order by e.created_at desc
           limit 25) p), '[]'::jsonb)
    ),

    'storage', coalesce((select jsonb_object_agg(bucket_id, n) from
                  (select bucket_id, count(*) n from storage.objects
                    where bucket_id in ('property-images', 'whatsapp-media') group by 1) s), '{}'::jsonb)
  );
$$;

-- ------------------------------------------------------------------ privileges: service role only
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.admin_update_property(uuid, integer, jsonb, text)',
    'public.admin_arrange_property_images(uuid, integer, uuid[], uuid, text)',
    'public.property_publication_check(uuid)', 'public.generate_property_draft(uuid, text)',
    'public.ingest_whatsapp_message(jsonb, text)', 'public.admin_operations_status()']
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;
