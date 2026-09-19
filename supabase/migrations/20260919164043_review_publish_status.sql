-- =============================================================================
-- Phase 8 — listing review, publication and status management
--
-- One authoritative database path for every lifecycle decision:
--   property_publication_check   the single publication rule set (UI shows it, publish enforces it)
--   admin_review_property        approve / reject (reason required) a draft
--   admin_publish_property       publish (or relist) — only when the check passes; slug and ownership preserved
--   admin_set_listing_status     sold / rented / archived / draft (unpublish, restore)
--   whatsapp_status_command      deterministic parser for "sold|rented|archive <exact listing reference>" (no AI)
--   apply_whatsapp_status_command  ownership-checked status change for a resolved agent
-- All mutations lock the property row, are idempotent (repeating a completed action returns the current state),
-- reject stale admin actions (state_version), never delete, and write automation_events.
-- Existing guards stay authoritative: properties_listing_lifecycle (transitions), properties_publishable,
-- properties_sold_is_sale / properties_rented_is_rent, RLS on the public read model.
-- Rollback: docs/rebuild/phase-08-review-publish-status.md, section "Rollback".
-- =============================================================================

-- ------------------------------------------------------------------ properties: review columns + version
alter table public.properties
  add column review_note   text,
  add column reviewed_at   timestamptz,
  add column reviewed_by   text,
  add column state_version integer not null default 1,
  add constraint properties_review_note_check
    check (review_note is null or (btrim(review_note) <> '' and char_length(review_note) <= 500)),
  add constraint properties_rejection_has_reason
    check (review_status is distinct from 'rejected' or review_note is not null),
  add constraint properties_reviewed_by_check check (char_length(reviewed_by) <= 120),
  add constraint properties_state_version_check check (state_version >= 1);

comment on column public.properties.review_note is 'Reason given by the reviewer when a draft is rejected. Private.';
comment on column public.properties.reviewed_by is 'Reviewer reference (admin session reference). Private.';
comment on column public.properties.state_version is
  'Incremented on every update. Admin actions carry the version they were rendered with; a mismatch is a stale '
  'action and is refused instead of overwriting newer state.';

create function public.properties_state_version()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  new.state_version := old.state_version + 1;
  return new;
end;
$$;
revoke execute on function public.properties_state_version() from public, anon, authenticated;

create trigger properties_state_version_trg
  before update on public.properties
  for each row execute function public.properties_state_version();

-- ------------------------------------------------------------------ whatsapp command values
alter table public.whatsapp_messages drop constraint whatsapp_messages_command_check;
alter table public.whatsapp_messages add constraint whatsapp_messages_command_check
  check (command in ('finish', 'cancel', 'status_sold', 'status_rented', 'status_archived'));

-- ------------------------------------------------------------------ helpers
create function public.property_event(p_property properties, p_type text, p_severity text, p_source text,
                                      p_correlation text, p_details jsonb, p_message_id uuid default null)
returns void
language sql
set search_path = public, pg_temp
as $$
  insert into automation_events (agency_id, event_type, severity, source, session_id, message_id, property_id,
                                 correlation_id, details)
  values (p_property.agency_id, p_type, p_severity, p_source, p_property.created_from_session_id, p_message_id,
          p_property.id, left(p_correlation, 200), jsonb_strip_nulls(coalesce(p_details, '{}'::jsonb)));
$$;

create function public.admin_actor(p_actor text)
returns text
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select case when p_actor ~ '^[A-Za-z0-9:._-]{1,120}$' then p_actor else 'admin' end;
$$;

-- ------------------------------------------------------------------ the publication rule set
create function public.property_publication_check(p_property_id uuid)
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
                   where c ->> 'resolution' is distinct from 'latest_correction') then
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
comment on function public.property_publication_check(uuid) is
  'The single publication rule set: lifecycle state, agency/agent ownership, approved review, required fields, valid '
  'extraction without unresolved conflicts, no photos still processing. Used by the admin UI and by publication.';

-- ------------------------------------------------------------------ admin: approve / reject
create function public.admin_review_property(p_property_id uuid, p_decision text, p_reason text,
                                             p_expected_version integer, p_actor text default null)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  p        properties%rowtype;
  v_actor  text := admin_actor(p_actor);
  v_reason text := nullif(btrim(regexp_replace(coalesce(p_reason, ''), '[[:cntrl:]]', ' ', 'g')), '');
  v_target text := case p_decision when 'approve' then 'approved' when 'reject' then 'rejected' end;
  v_from   text;
begin
  if v_target is null or p_property_id is null then
    return jsonb_build_object('ok', false, 'outcome', 'invalid_request', 'reason', 'invalid_decision');
  end if;
  if v_target = 'rejected' and (v_reason is null or char_length(v_reason) not between 3 and 500) then
    return jsonb_build_object('ok', false, 'outcome', 'invalid_request', 'reason', 'reason_required');
  end if;

  select * into p from properties where id = p_property_id for update;
  if p.id is null then
    return jsonb_build_object('ok', false, 'outcome', 'not_found');
  end if;
  if p.agency_id is null then
    return jsonb_build_object('ok', false, 'outcome', 'not_reviewable', 'reason', 'no_agency');
  end if;
  if p.listing_status <> 'draft' then
    return jsonb_build_object('ok', false, 'outcome', 'invalid_state', 'listing_status', p.listing_status);
  end if;
  if p.review_status = v_target then
    return jsonb_build_object('ok', true, 'outcome', 'already', 'review_status', p.review_status,
                              'review_note', p.review_note, 'state_version', p.state_version);
  end if;
  if p_expected_version is distinct from p.state_version then
    return jsonb_build_object('ok', false, 'outcome', 'stale', 'review_status', p.review_status,
                              'listing_status', p.listing_status, 'state_version', p.state_version);
  end if;

  v_from := p.review_status;
  update properties
     set review_status = v_target,
         review_note   = case when v_target = 'rejected' then v_reason end,
         reviewed_at   = now(),
         reviewed_by   = v_actor
   where id = p.id
  returning * into p;

  perform property_event(p, 'property.review_' || v_target, 'info', 'admin', null,
    jsonb_build_object('actor', v_actor, 'from', v_from, 'to', v_target,
                       'reason', case when v_target = 'rejected' then v_reason end));
  return jsonb_build_object('ok', true, 'outcome', v_target, 'review_status', p.review_status,
                            'state_version', p.state_version);
end;
$$;

-- ------------------------------------------------------------------ admin: publish / relist
create function public.admin_publish_property(p_property_id uuid, p_expected_version integer,
                                              p_actor text default null)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  p       properties%rowtype;
  v_actor text := admin_actor(p_actor);
  v_check jsonb;
  v_from  text;
begin
  select * into p from properties where id = p_property_id for update;
  if p.id is null then
    return jsonb_build_object('ok', false, 'outcome', 'not_found');
  end if;
  if p.listing_status = 'published' then
    return jsonb_build_object('ok', true, 'outcome', 'already', 'slug', p.slug, 'published_at', p.published_at,
                              'state_version', p.state_version);
  end if;
  if p_expected_version is distinct from p.state_version then
    return jsonb_build_object('ok', false, 'outcome', 'stale', 'listing_status', p.listing_status,
                              'state_version', p.state_version);
  end if;

  v_check := property_publication_check(p.id);
  if not (v_check ->> 'publishable')::boolean then
    perform property_event(p, 'property.publish_blocked', 'info', 'admin', null,
      jsonb_build_object('actor', v_actor, 'blockers', v_check -> 'blockers'));
    return jsonb_build_object('ok', false, 'outcome', 'blocked', 'blockers', v_check -> 'blockers');
  end if;

  v_from := p.listing_status;
  begin
    update properties set listing_status = 'published' where id = p.id returning * into p;
  exception when check_violation then
    perform property_event(p, 'property.publish_blocked', 'warning', 'admin', null,
      jsonb_build_object('actor', v_actor, 'blockers', jsonb_build_array('database_guard'), 'detail', left(sqlerrm, 300)));
    return jsonb_build_object('ok', false, 'outcome', 'blocked', 'blockers', jsonb_build_array('database_guard'));
  end;

  perform property_event(p, 'property.published', 'info', 'admin', null,
    jsonb_build_object('actor', v_actor, 'from', v_from, 'slug', p.slug, 'image_count', v_check -> 'image_count'));
  return jsonb_build_object('ok', true, 'outcome', 'published', 'slug', p.slug, 'published_at', p.published_at,
                            'state_version', p.state_version);
end;
$$;

-- ------------------------------------------------------------------ admin: other lifecycle changes
create function public.admin_set_listing_status(p_property_id uuid, p_target text, p_expected_version integer,
                                                p_actor text default null, p_reason text default null)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  p        properties%rowtype;
  v_actor  text := admin_actor(p_actor);
  v_reason text := left(nullif(btrim(regexp_replace(coalesce(p_reason, ''), '[[:cntrl:]]', ' ', 'g')), ''), 500);
  v_from   text;
  v_ok     boolean;
begin
  if p_target not in ('sold', 'rented', 'archived', 'draft') then
    return jsonb_build_object('ok', false, 'outcome', 'invalid_request', 'reason', 'invalid_target');
  end if;
  select * into p from properties where id = p_property_id for update;
  if p.id is null then
    return jsonb_build_object('ok', false, 'outcome', 'not_found');
  end if;
  if p.agency_id is null then
    return jsonb_build_object('ok', false, 'outcome', 'not_reviewable', 'reason', 'no_agency');
  end if;
  if p.listing_status = p_target then
    return jsonb_build_object('ok', true, 'outcome', 'already', 'listing_status', p.listing_status,
                              'state_version', p.state_version);
  end if;
  if p_expected_version is distinct from p.state_version then
    return jsonb_build_object('ok', false, 'outcome', 'stale', 'listing_status', p.listing_status,
                              'state_version', p.state_version);
  end if;

  v_ok := case p_target
            when 'sold'     then p.listing_status = 'published' and p.intent = 'buy'
            when 'rented'   then p.listing_status = 'published' and p.intent = 'rent'
            when 'archived' then p.listing_status in ('draft', 'published', 'sold', 'rented')
            when 'draft'    then p.listing_status in ('published', 'archived')
          end;
  if not v_ok then
    return jsonb_build_object('ok', false, 'outcome', 'invalid_transition', 'listing_status', p.listing_status,
                              'intent', p.intent);
  end if;

  v_from := p.listing_status;
  begin
    update properties set listing_status = p_target where id = p.id returning * into p;
  exception when check_violation then
    return jsonb_build_object('ok', false, 'outcome', 'invalid_transition', 'listing_status', v_from);
  end;
  perform property_event(p, 'property.status_changed', 'info', 'admin', null,
    jsonb_build_object('actor_kind', 'admin', 'actor', v_actor, 'from', v_from, 'to', p_target, 'reason', v_reason));
  return jsonb_build_object('ok', true, 'outcome', 'changed', 'from', v_from, 'listing_status', p.listing_status,
                            'state_version', p.state_version);
end;
$$;

-- ------------------------------------------------------------------ WhatsApp status commands (deterministic)
create function public.whatsapp_status_command(p_body text)
returns jsonb
language plpgsql
immutable
set search_path = pg_catalog, pg_temp
as $$
declare
  v_text   text := btrim(regexp_replace(coalesce(p_body, ''), '[[:space:]]+', ' ', 'g'));
  v_tokens text[];
  v_action text;
  v_refs   text[] := '{}';
  v_tok    text;
  v_ref    text;
  v_slug   text;
  i        integer;
begin
  if v_text = '' or char_length(v_text) > 300 then
    return null;
  end if;
  v_tokens := regexp_split_to_array(v_text, ' ');
  v_action := case lower(regexp_replace(v_tokens[1], '[[:punct:]։՝՜՞«»…]+$', ''))
                when 'sold' then 'sold' when 'продано' then 'sold' when 'продана' then 'sold' when 'վաճառված' then 'sold'
                when 'rented' then 'rented' when 'сдано' then 'rented' when 'сдана' then 'rented'
                when 'վարձակալված' then 'rented'
                when 'archive' then 'archived' when 'remove' then 'archived' when 'архив' then 'archived'
                when 'убрать' then 'archived' when 'արխիվ' then 'archived'
              end;
  -- a status command is the keyword plus at most two more tokens; longer text is ordinary listing content
  if v_action is null or cardinality(v_tokens) > 3 then
    return null;
  end if;

  for i in 2 .. cardinality(v_tokens) loop
    v_tok := regexp_replace(v_tokens[i], '^[<("''[]+|[]>)"''.,;:!?]+$', '', 'g');
    if v_tok <> '' then v_refs := v_refs || v_tok; end if;
  end loop;
  if cardinality(v_refs) = 0 then
    return jsonb_build_object('action', v_action, 'problem', 'missing_reference');
  end if;
  if cardinality(v_refs) > 1 then
    return jsonb_build_object('action', v_action, 'problem', 'ambiguous_reference');
  end if;

  v_ref := lower(v_refs[1]);
  if v_ref ~ '^https?://' then
    v_slug := substring(v_ref from '^https?://[a-z0-9.-]+(?::[0-9]+)?/properties/([a-z0-9]+(?:-[a-z0-9]+)*)/?(?:[?#].*)?$');
  elsif v_ref ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(v_ref) <= 200 then
    v_slug := v_ref;
  end if;
  if v_slug is null then
    return jsonb_build_object('action', v_action, 'problem', 'invalid_reference');
  end if;
  return jsonb_build_object('action', v_action, 'reference', v_slug);
end;
$$;
comment on function public.whatsapp_status_command(text) is
  'Deterministic parser (no AI): "<sold|rented|archive|remove|…> <listing slug or listing URL>". Returns null for '
  'ordinary text; otherwise {action, reference} or {action, problem}. No fuzzy matching.';

create function public.apply_whatsapp_status_command(p_message_id uuid, p_agent_id uuid, p_agency_id uuid,
                                                     p_command jsonb, p_correlation_id text default null)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_action text := p_command ->> 'action';
  v_ref    text := p_command ->> 'reference';
  v_issue  text := p_command ->> 'problem';
  p        properties%rowtype;
  g        agents%rowtype;
  v_from   text;
  v_reply  text;
  v_word   text := case p_command ->> 'action' when 'sold' then 'sold' when 'rented' then 'rented' else 'archived' end;
  v_exists boolean;
  v_ok     boolean;
begin
  select * into g from agents where id = p_agent_id;
  if v_issue is null and (g.id is null or not g.is_active or g.agency_id is distinct from p_agency_id) then
    v_issue := 'sender_not_permitted';
  end if;

  if v_issue is null then
    -- only the sender's own listing in the sender's own agency, by exact slug
    select * into p from properties
     where slug = v_ref and agency_id = p_agency_id and agent_id = p_agent_id
     for update;
    if p.id is null then
      select exists (select 1 from properties where slug = v_ref) into v_exists;
      v_issue := case when v_exists then 'not_permitted' else 'not_found' end;
    end if;
  end if;

  if v_issue is not null then
    v_reply := case v_issue
      when 'missing_reference'   then 'Not applied: add the listing reference, e.g. "'
                                      || case v_action when 'archived' then 'archive' else v_action end || ' <listing link>".'
      when 'ambiguous_reference' then 'Not applied: send exactly one listing reference per message.'
      when 'invalid_reference'   then 'Not applied: the reference must be the listing link or its exact reference.'
      else 'Not applied: no listing of yours matches that reference.'
    end;
    insert into automation_events (agency_id, event_type, severity, source, message_id, correlation_id, details)
    values (p_agency_id, 'property.status_command_rejected', 'info', 'n8n', p_message_id, left(p_correlation_id, 200),
            jsonb_strip_nulls(jsonb_build_object('action', v_action, 'reference', left(v_ref, 200), 'reason', v_issue,
                                                 'agent_id', p_agent_id, 'reply_text', v_reply)));
    -- not_found and not_permitted produce the same answer: the sender learns nothing about other listings
    return jsonb_build_object('applied', false, 'outcome', 'rejected', 'action', v_action,
                              'reason', case when v_issue in ('not_found', 'not_permitted', 'sender_not_permitted')
                                             then 'not_found_or_not_permitted' else v_issue end,
                              'reply_text', v_reply);
  end if;

  if p.listing_status = v_action then
    v_reply := 'No change: ' || p.slug || ' is already ' || v_word || '.';
    perform property_event(p, 'property.status_command_duplicate', 'info', 'n8n', p_correlation_id,
      jsonb_build_object('action', v_action, 'agent_id', p_agent_id, 'reply_text', v_reply), p_message_id);
    return jsonb_build_object('applied', false, 'outcome', 'already', 'action', v_action, 'slug', p.slug,
                              'listing_status', p.listing_status, 'reply_text', v_reply);
  end if;

  v_ok := case v_action
            when 'sold'     then p.listing_status = 'published' and p.intent = 'buy'
            when 'rented'   then p.listing_status = 'published' and p.intent = 'rent'
            when 'archived' then p.listing_status in ('published', 'sold', 'rented')
          end;
  if not coalesce(v_ok, false) then
    v_reply := case
      when v_action = 'sold' and p.listing_status = 'published' and p.intent = 'rent'
        then 'Not applied: ' || p.slug || ' is listed for rent — send "rented ' || p.slug || '".'
      when v_action = 'rented' and p.listing_status = 'published' and p.intent = 'buy'
        then 'Not applied: ' || p.slug || ' is listed for sale — send "sold ' || p.slug || '".'
      else 'Not applied: ' || p.slug || ' is ' || p.listing_status || ', so it cannot be marked ' || v_word || '.'
    end;
    perform property_event(p, 'property.status_command_rejected', 'info', 'n8n', p_correlation_id,
      jsonb_build_object('action', v_action, 'agent_id', p_agent_id, 'reason', 'invalid_transition',
                         'listing_status', p.listing_status, 'reply_text', v_reply), p_message_id);
    return jsonb_build_object('applied', false, 'outcome', 'rejected', 'action', v_action, 'reason', 'invalid_transition',
                              'reply_text', v_reply);
  end if;

  v_from := p.listing_status;
  begin
    update properties set listing_status = v_action where id = p.id returning * into p;
  exception when check_violation then
    v_reply := 'Not applied: ' || p.slug || ' cannot be marked ' || v_word || '.';
    perform property_event(p, 'property.status_command_rejected', 'warning', 'n8n', p_correlation_id,
      jsonb_build_object('action', v_action, 'agent_id', p_agent_id, 'reason', 'database_guard', 'reply_text', v_reply),
      p_message_id);
    return jsonb_build_object('applied', false, 'outcome', 'rejected', 'action', v_action, 'reason', 'database_guard',
                              'reply_text', v_reply);
  end;

  v_reply := 'Done: ' || p.slug || ' is now ' || v_word || '.';
  perform property_event(p, 'property.status_changed', 'info', 'n8n', p_correlation_id,
    jsonb_build_object('actor_kind', 'whatsapp_agent', 'agent_id', p_agent_id, 'from', v_from, 'to', v_action,
                       'reply_text', v_reply), p_message_id);
  return jsonb_build_object('applied', true, 'outcome', 'applied', 'action', v_action, 'slug', p.slug,
                            'from', v_from, 'listing_status', p.listing_status, 'reply_text', v_reply);
end;
$$;
comment on function public.apply_whatsapp_status_command(uuid, uuid, uuid, jsonb, text) is
  'Applies a parsed status command for a resolved agent: exact slug, the agent''s own listing in the agent''s own agency '
  'only, allowed transitions only, row-locked, idempotent. Unknown and foreign references get the same reply.';

-- ------------------------------------------------------------------ admin read models (service role only)
create view public.admin_property_review
with (security_invoker = true)
as
select
  p.id, p.slug, p.title, p.listing_status, p.review_status, p.review_note, p.reviewed_at, p.reviewed_by,
  p.state_version, p.intent, p.property_type, p.price, p.currency, p.price_period, p.country, p.city, p.district,
  p.rooms, p.bedrooms, p.bathrooms, p.area_sqm, p.source, p.created_at, p.updated_at, p.published_at,
  p.listing_status_changed_at, p.agency_id, a.name as agency_name, p.agent_id, g.name as agent_name,
  g.is_active as agent_active, p.created_from_session_id, s.status as session_status,
  er.id as extraction_id, er.validation_status as extraction_status, er.created_at as extracted_at,
  coalesce(jsonb_array_length(er.extracted_data -> 'conflicts'), 0) as conflict_count,
  coalesce(jsonb_array_length(er.validation_errors), 0) as issue_count,
  (select count(*) from property_images i where i.property_id = p.id) as image_count,
  coalesce(ms.counts, '{}'::jsonb) as media_counts,
  property_publication_check(p.id) as publication
from properties p
left join agencies a on a.id = p.agency_id
left join agents g on g.id = p.agent_id
left join submission_sessions s on s.id = p.created_from_session_id
left join lateral (
  select * from extraction_results x where x.property_id = p.id order by x.created_at desc limit 1
) er on true
left join lateral (
  select jsonb_object_agg(st, n) as counts from (
    select wm.download_status as st, count(*) as n
      from whatsapp_media wm join whatsapp_messages m on m.id = wm.message_id
     where p.created_from_session_id is not null and m.session_id = p.created_from_session_id
     group by wm.download_status) t
) ms on true;
comment on view public.admin_property_review is
  'Admin review queue (service role only): property, ownership, extraction and media state, and the publication check.';

create view public.admin_media_issues
with (security_invoker = true)
as
select wm.id as media_id, wm.download_status, wm.status_reason, wm.failed_stage, wm.last_error, wm.mime_type,
       wm.detected_mime_type, wm.file_size, wm.download_attempts, wm.validation_attempts, wm.attach_attempts,
       wm.download_deadline_at, wm.created_at, wm.updated_at, wm.agency_id, a.name as agency_name,
       m.id as message_id, m.message_type, m.provider_timestamp, m.session_id, s.status as session_status,
       m.agent_id, g.name as agent_name, p.id as property_id, p.slug as property_slug, p.title as property_title
from whatsapp_media wm
join whatsapp_messages m on m.id = wm.message_id
left join agencies a on a.id = wm.agency_id
left join agents g on g.id = m.agent_id
left join submission_sessions s on s.id = m.session_id
left join properties p on p.created_from_session_id = m.session_id
where wm.download_status in ('rejected', 'failed', 'expired')
   or (wm.download_status in ('validated', 'uploaded') and wm.status_reason like 'held:%');
comment on view public.admin_media_issues is 'Media needing attention: held, rejected, failed, expired (service role only).';

create view public.admin_submission_issues
with (security_invoker = true)
as
select s.id as session_id, s.status as session_status, s.close_reason, s.last_error, s.started_at,
       s.last_message_at, s.agency_id, a.name as agency_name, s.agent_id, g.name as agent_name,
       er.id as extraction_id, er.status as extraction_result, er.validation_status, er.validation_errors,
       coalesce(jsonb_array_length(er.extracted_data -> 'conflicts'), 0) as conflict_count, er.created_at as extracted_at,
       p.id as property_id, p.slug as property_slug
from submission_sessions s
left join agencies a on a.id = s.agency_id
left join agents g on g.id = s.agent_id
left join lateral (
  select * from extraction_results x where x.session_id = s.id order by x.created_at desc limit 1
) er on true
left join properties p on p.created_from_session_id = s.id
where s.status in ('needs_review', 'failed')
   or er.validation_status in ('incomplete', 'conflicting', 'invalid');
comment on view public.admin_submission_issues is
  'Submissions that did not become a draft cleanly: incomplete, conflicting, invalid or failed (service role only).';

revoke all on table public.admin_property_review, public.admin_media_issues, public.admin_submission_issues
  from public, anon, authenticated;
grant select on table public.admin_property_review, public.admin_media_issues, public.admin_submission_issues
  to service_role;

-- ------------------------------------------------------------------ privileges: service role only
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.property_event(public.properties, text, text, text, text, jsonb, uuid)', 'public.admin_actor(text)',
    'public.property_publication_check(uuid)', 'public.admin_review_property(uuid, text, text, integer, text)',
    'public.admin_publish_property(uuid, integer, text)', 'public.admin_set_listing_status(uuid, text, integer, text, text)',
    'public.whatsapp_status_command(text)', 'public.apply_whatsapp_status_command(uuid, uuid, uuid, jsonb, text)']
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;
