-- Phase 10 (1/2) — agency and agent management.
--
-- * agencies: public profile fields (display/legal name, public phone, WhatsApp, email, office), is_active and one
--   is_site_primary agency whose public profile drives the website's brand and contact details.
-- * public_site_profile: the ONLY anonymous window onto agencies — public profile columns of the active site agency
--   (RLS policy + column grants, security_invoker; no id, slug, WhatsApp number id or settings).
-- * published_property_listings no longer exposes agency_id (the website never used it).
-- * contact_is_placeholder(): rejects obviously fake contact values (example domains, 00000000-style numbers).
-- * admin_save_agency / admin_save_agent / admin_link_agent_identity: the only admin write paths for agencies and
--   agents (service role only). Phase 6.5 identity rules are kept: BSUID globally unique, one WhatsApp phone per agent,
--   an agent's agency cannot change once it has history, identities are never silently re-assigned.
-- * admin_agents / admin_unlinked_senders: service-role-only read models for the admin.
--
-- Rollback: see docs/rebuild/phase-10-agency-agent-listing-management.md (§ Rollback).

-- ------------------------------------------------------------------ agencies: public profile + state
alter table public.agencies
  add column display_name    text,
  add column legal_name      text,
  add column public_phone    text,
  add column public_whatsapp text,
  add column public_email    text,
  add column office_address  text,
  add column office_hours    text,
  add column is_active       boolean not null default true,
  add column is_site_primary boolean not null default false;

alter table public.agencies
  add constraint agencies_display_name_check
    check (display_name is null or (btrim(display_name) <> '' and char_length(display_name) <= 80
                                    and display_name !~ '[[:cntrl:]]')),
  add constraint agencies_legal_name_check
    check (legal_name is null or (btrim(legal_name) <> '' and char_length(legal_name) <= 160
                                  and legal_name !~ '[[:cntrl:]]')),
  add constraint agencies_public_phone_e164 check (public_phone ~ '^\+[1-9][0-9]{6,14}$'),
  add constraint agencies_public_whatsapp_e164 check (public_whatsapp ~ '^\+[1-9][0-9]{6,14}$'),
  add constraint agencies_public_email_format
    check (public_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(public_email) <= 254),
  add constraint agencies_office_address_check
    check (office_address is null or (btrim(office_address) <> '' and char_length(office_address) <= 200
                                      and office_address !~ '[[:cntrl:]]')),
  add constraint agencies_office_hours_check
    check (office_hours is null or (btrim(office_hours) <> '' and char_length(office_hours) <= 120
                                    and office_hours !~ '[[:cntrl:]]')),
  add constraint agencies_site_primary_active check (not is_site_primary or is_active);

create unique index agencies_one_site_primary on public.agencies ((true)) where is_site_primary;

comment on column public.agencies.is_site_primary is
  'The agency whose public profile (display name, contacts) the website shows. At most one; must be active.';
comment on column public.agencies.is_active is
  'Inactive agency: inbound WhatsApp is stored but never processed (agency_inactive), drafts are not generated and '
  'nothing new can be published. Existing listings are unchanged.';

-- Heuristic guard against shipping fake contact details. Deliberately conservative: example/test domains and numbers
-- whose last eight digits are one repeated digit or a counting sequence.
create or replace function public.contact_is_placeholder(p_value text)
returns boolean
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select case
    when p_value is null or btrim(p_value) = '' then false
    when position('@' in p_value) > 0 then
      lower(split_part(btrim(p_value), '@', 2)) ~ '(^|\.)(example\.(com|org|net)|example|invalid|test|localhost)$'
    else right(regexp_replace(p_value, '\D', '', 'g'), 8)
           in ('00000000', '11111111', '22222222', '33333333', '44444444', '55555555', '66666666', '77777777',
               '88888888', '99999999', '12345678', '23456789', '87654321')
  end;
$$;

-- ------------------------------------------------------------------ public site profile (anonymous, narrow)
create policy agencies_public_read_site_profile on public.agencies
  for select to anon, authenticated
  using (is_site_primary and is_active);

grant select (display_name, legal_name, public_phone, public_whatsapp, public_email, office_address, office_hours,
              is_site_primary, is_active)
  on public.agencies to anon, authenticated;

create view public.public_site_profile
with (security_invoker = true) as
select a.display_name, a.legal_name, a.public_phone, a.public_whatsapp, a.public_email, a.office_address,
       a.office_hours
  from public.agencies a
 where a.is_site_primary and a.is_active;

comment on view public.public_site_profile is
  'Public brand and contact details of the site agency (at most one row). security_invoker: the agencies RLS policy '
  'and column grants apply; nothing else about agencies is readable anonymously.';

revoke all on table public.public_site_profile from anon, authenticated;
grant select on table public.public_site_profile to anon, authenticated;

-- ------------------------------------------------------------------ published listings: drop agency_id
drop view public.published_property_listings;

create view public.published_property_listings
with (security_invoker = true) as
select
  p.id,
  p.slug,
  p.title,
  p.description,
  p.intent,
  p.property_type,
  p.country,
  p.city,
  p.district,
  p.price,
  p.currency,
  p.price_period,
  p.price_negotiable,
  p.area_sqm,
  p.land_area_sqm,
  p.rooms,
  p.bedrooms,
  p.bathrooms,
  p.floor,
  p.total_floors,
  p.year_built,
  p.features,
  p.featured,
  p.published_at,
  p.updated_at,
  cover.storage_path as primary_image_path,
  coalesce(gallery.images, '[]'::jsonb) as images
from public.properties p
left join lateral (
  select i.storage_path
  from public.property_images i
  where i.property_id = p.id
  order by i.is_primary desc, i.sort_order
  limit 1
) cover on true
left join lateral (
  select jsonb_agg(
           jsonb_build_object(
             'id', i.id,
             'storage_path', i.storage_path,
             'sort_order', i.sort_order,
             'alt_text', i.alt_text,
             'is_primary', i.is_primary,
             'width', i.width,
             'height', i.height
           )
           order by i.sort_order
         ) as images
  from public.property_images i
  where i.property_id = p.id
) gallery on true
where p.listing_status = 'published';

comment on view public.published_property_listings is
  'Public read model: published properties with their ordered images (storage paths in the property-images bucket). '
  'No agency/agent identifiers. '
  'security_invoker: RLS and column grants of the caller apply.';

revoke all on table public.published_property_listings from anon, authenticated;
grant select on table public.published_property_listings to anon, authenticated;
revoke select (agency_id) on public.properties from anon, authenticated;

-- ------------------------------------------------------------------ admin read models (service role only)
create view public.admin_agents
with (security_invoker = true) as
select g.id, g.agency_id, a.name as agency_name, a.is_active as agency_active, g.name, g.is_active,
       g.whatsapp_user_id, g.whatsapp_phone, g.phone, g.email, g.created_at, g.updated_at,
       (select count(*) from properties p where p.agent_id = g.id) as listing_count,
       (select count(*) from properties p where p.agent_id = g.id and p.listing_status = 'published') as published_count,
       (select max(m.received_at) from whatsapp_messages m where m.agent_id = g.id) as last_message_at,
       (exists (select 1 from properties p where p.agent_id = g.id)
        or exists (select 1 from submission_sessions s where s.agent_id = g.id)
        or exists (select 1 from whatsapp_messages m where m.agent_id = g.id)) as has_history
  from agents g
  join agencies a on a.id = g.agency_id;

comment on view public.admin_agents is 'Agents with agency, identity and activity summary (service role only).';

-- Direct-chat senders the pipeline could not attribute to an agent, plus BSUIDs seen for agents registered by phone
-- only. Lets an admin link a REAL identity from a stored message instead of typing it. Never public.
create view public.admin_unlinked_senders
with (security_invoker = true) as
with unresolved as (
  select m.id as message_id, m.agency_id, m.sender_user_id, m.sender_phone, m.sender_name, m.body, m.received_at,
         (select e.details ->> 'reason' from automation_events e
           where e.message_id = m.id and e.event_type = 'whatsapp.sender_unresolved'
           order by e.id desc limit 1) as reason,
         null::uuid as suggested_agent_id,
         'unregistered'::text as kind
    from whatsapp_messages m
   where m.processing_status = 'unresolved_sender' and m.conversation_type = 'direct'
     and not exists (select 1 from agents g where m.sender_user_id is not null and g.whatsapp_user_id = m.sender_user_id)
     and not (m.sender_user_id is null
              and exists (select 1 from agents g where g.agency_id = m.agency_id and g.whatsapp_phone = m.sender_phone))
  union all
  select m.id, m.agency_id, m.sender_user_id, m.sender_phone, m.sender_name, m.body, m.received_at,
         'bsuid_not_registered', g.id, 'bsuid_unlinked'
    from whatsapp_messages m
    join agents g on g.id = m.agent_id
   where m.sender_user_id is not null and g.whatsapp_user_id is null and m.conversation_type = 'direct'
     and not exists (select 1 from agents o where o.whatsapp_user_id = m.sender_user_id)
), ranked as (
  select u.*, count(*) over w as message_count, row_number() over (w order by u.received_at desc) as rn
    from unresolved u
  window w as (partition by u.kind, u.agency_id, coalesce(u.sender_user_id, u.sender_phone))
)
select r.message_id, r.kind, r.agency_id, a.name as agency_name, r.sender_user_id, r.sender_phone, r.sender_name,
       left(r.body, 120) as body_preview, r.received_at, r.reason, r.suggested_agent_id, r.message_count
  from ranked r
  join agencies a on a.id = r.agency_id
 where r.rn = 1;

comment on view public.admin_unlinked_senders is
  'Unattributed direct WhatsApp senders (latest message per identity) and unregistered BSUIDs of phone-registered '
  'agents. Service role only; source for admin_link_agent_identity.';

revoke all on table public.admin_agents, public.admin_unlinked_senders from public, anon, authenticated;
grant select on table public.admin_agents, public.admin_unlinked_senders to service_role;

-- ------------------------------------------------------------------ shared helpers
-- Normalises a phone typed by a person ("+374 99 12-34-56", "0037499123456") to E.164 text; anything else unchanged
-- (the table constraints then reject it with a field-specific error).
create or replace function public.admin_normalize_phone(p_value text)
returns text
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select case
    when p_value is null or btrim(p_value) = '' then null
    else regexp_replace(regexp_replace(btrim(p_value), '[\s().-]', '', 'g'), '^00', '+')
  end;
$$;

-- Maps a constraint name to the admin form field it guards.
create or replace function public.admin_constraint_field(p_constraint text)
returns text
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select case
    when p_constraint is null then null
    when p_constraint like 'agencies_one_site_primary%' then 'is_site_primary'
    when p_constraint like 'agencies_whatsapp_phone_number_id%' then 'whatsapp_phone_number_id'
    when p_constraint like 'agencies_public_phone%' then 'public_phone'
    when p_constraint like 'agencies_public_whatsapp%' then 'public_whatsapp'
    when p_constraint like 'agencies_public_email%' then 'public_email'
    when p_constraint like 'agents_whatsapp_user_id%' then 'whatsapp_user_id'
    when p_constraint like 'agents_agency_whatsapp_phone%' or p_constraint like 'agents_whatsapp_phone%' then 'whatsapp_phone'
    when p_constraint like 'agents_phone%' then 'phone'
    when p_constraint like 'agents_agency_email%' or p_constraint like 'agents_email%' then 'email'
    when p_constraint in ('properties_floor_within_building') then 'floor'
    when p_constraint in ('properties_rented_is_rent', 'properties_sold_is_sale') then 'intent'
    when p_constraint = 'properties_sale_has_no_price_period' then 'price_period'
    when p_constraint = 'properties_price_positive' then 'price'
    when p_constraint = 'properties_text_not_blank' then 'text'
    when p_constraint = 'properties_publishable' then 'publication'
    else regexp_replace(regexp_replace(p_constraint, '^(agencies|agents|properties)_', ''),
                        '_(check|format|key|e164)$', '')
  end;
$$;

-- ------------------------------------------------------------------ agencies
create or replace function public.admin_save_agency(
  p_agency_id uuid, p_values jsonb, p_expected_updated_at timestamptz default null, p_actor text default null)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  c_text    constant text[] := array['name', 'slug', 'display_name', 'legal_name', 'public_phone', 'public_whatsapp',
                                     'public_email', 'office_address', 'office_hours', 'whatsapp_phone_number_id'];
  c_bool    constant text[] := array['is_active', 'is_site_primary'];
  c_contact constant text[] := array['public_phone', 'public_whatsapp', 'public_email'];
  v_actor   text := admin_actor(p_actor);
  v_old     agencies%rowtype;
  v_new     agencies%rowtype;
  v_clean   jsonb := '{}'::jsonb;
  k         text;
  v         jsonb;
  s         text;
  v_changed text[] := '{}';
  v_count   integer;
  v_constraint text;
begin
  if p_values is null or jsonb_typeof(p_values) <> 'object' then
    return jsonb_build_object('ok', false, 'outcome', 'invalid_request', 'reason', 'values_not_object');
  end if;

  -- whitelist + type checks + normalisation ('' -> null, trimmed, phones to E.164)
  for k, v in select * from jsonb_each(p_values) loop
    if k = any (c_text) then
      if jsonb_typeof(v) not in ('string', 'null') then
        return jsonb_build_object('ok', false, 'outcome', 'invalid_value', 'field', k, 'reason', 'type');
      end if;
      s := nullif(btrim(v #>> '{}'), '');
      if k in ('public_phone', 'public_whatsapp') then s := admin_normalize_phone(s); end if;
      if k = 'public_email' then s := lower(s); end if;
      if k = any (c_contact) and contact_is_placeholder(s) then
        return jsonb_build_object('ok', false, 'outcome', 'invalid_value', 'field', k, 'reason', 'placeholder');
      end if;
      v_clean := v_clean || jsonb_build_object(k, s);
    elsif k = any (c_bool) then
      if jsonb_typeof(v) <> 'boolean' then
        return jsonb_build_object('ok', false, 'outcome', 'invalid_value', 'field', k, 'reason', 'type');
      end if;
      v_clean := v_clean || jsonb_build_object(k, v);
    else
      return jsonb_build_object('ok', false, 'outcome', 'invalid_request', 'reason', 'unknown_field', 'field', k);
    end if;
  end loop;

  if p_agency_id is null then
    -- ---------------------------------------------------------------- create
    if v_clean ->> 'name' is null then
      return jsonb_build_object('ok', false, 'outcome', 'invalid_value', 'field', 'name', 'reason', 'required');
    end if;
    s := coalesce(v_clean ->> 'slug',
                  nullif(btrim(regexp_replace(lower(v_clean ->> 'name'), '[^a-z0-9]+', '-', 'g'), '-'), ''),
                  'agency');
    if exists (select 1 from agencies where slug = s) and v_clean ->> 'slug' is null then
      s := left(s, 50) || '-' || substr(md5(random()::text), 1, 6);
    end if;
    if coalesce((v_clean ->> 'is_site_primary')::boolean, false) then
      if not coalesce((v_clean ->> 'is_active')::boolean, true) then
        return jsonb_build_object('ok', false, 'outcome', 'invalid_value', 'field', 'is_active',
                                  'reason', 'site_agency_must_be_active');
      end if;
      update agencies set is_site_primary = false where is_site_primary;
    end if;
    begin
      insert into agencies (name, slug, display_name, legal_name, public_phone, public_whatsapp, public_email,
                            office_address, office_hours, whatsapp_phone_number_id, is_active, is_site_primary)
      values (v_clean ->> 'name', s, v_clean ->> 'display_name', v_clean ->> 'legal_name', v_clean ->> 'public_phone',
              v_clean ->> 'public_whatsapp', v_clean ->> 'public_email', v_clean ->> 'office_address',
              v_clean ->> 'office_hours', v_clean ->> 'whatsapp_phone_number_id',
              coalesce((v_clean ->> 'is_active')::boolean, true),
              coalesce((v_clean ->> 'is_site_primary')::boolean, false))
      returning * into v_new;
    exception when check_violation or unique_violation or not_null_violation then
      get stacked diagnostics v_constraint = constraint_name;
      return jsonb_build_object('ok', false, 'outcome', 'invalid_value', 'field', admin_constraint_field(v_constraint),
                                'reason', case when sqlstate = '23505' then 'in_use' else 'format' end);
    end;
    insert into automation_events (agency_id, event_type, severity, source, details)
    values (v_new.id, 'agency.created', 'info', 'admin',
            jsonb_build_object('actor', v_actor, 'fields', (select jsonb_agg(x) from jsonb_object_keys(v_clean) x)));
    return jsonb_build_object('ok', true, 'outcome', 'created', 'agency_id', v_new.id, 'updated_at', v_new.updated_at);
  end if;

  -- ------------------------------------------------------------------ update
  select * into v_old from agencies where id = p_agency_id for update;
  if v_old.id is null then
    return jsonb_build_object('ok', false, 'outcome', 'not_found');
  end if;
  if v_clean ? 'slug' and (v_clean ->> 'slug') is distinct from v_old.slug then
    return jsonb_build_object('ok', false, 'outcome', 'invalid_value', 'field', 'slug', 'reason', 'immutable');
  end if;

  v_new := jsonb_populate_record(v_old, v_clean);
  select coalesce(array_agg(key order by key), '{}') into v_changed
    from jsonb_each(to_jsonb(v_new)) n
   where key = any (c_text || c_bool) and n.value is distinct from to_jsonb(v_old) -> key;

  if cardinality(v_changed) = 0 then
    return jsonb_build_object('ok', true, 'outcome', 'unchanged', 'agency_id', v_old.id, 'updated_at', v_old.updated_at);
  end if;
  if p_expected_updated_at is distinct from v_old.updated_at then
    return jsonb_build_object('ok', false, 'outcome', 'stale', 'updated_at', v_old.updated_at);
  end if;

  if v_old.is_site_primary and not v_new.is_site_primary then
    return jsonb_build_object('ok', false, 'outcome', 'invalid_value', 'field', 'is_site_primary',
                              'reason', 'choose_another_site_agency');
  end if;
  if not v_new.is_active and v_new.is_site_primary then
    return jsonb_build_object('ok', false, 'outcome', 'invalid_value', 'field', 'is_active',
                              'reason', 'site_agency_must_be_active');
  end if;
  if v_old.is_active and not v_new.is_active then
    select count(*) into v_count from properties where agency_id = v_old.id and listing_status = 'published';
    if v_count > 0 then
      return jsonb_build_object('ok', false, 'outcome', 'invalid_value', 'field', 'is_active',
                                'reason', 'has_published_listings', 'count', v_count);
    end if;
  end if;

  if v_new.is_site_primary and not v_old.is_site_primary then
    update agencies set is_site_primary = false where is_site_primary and id <> v_old.id;
  end if;

  begin
    update agencies
       set name = v_new.name, display_name = v_new.display_name, legal_name = v_new.legal_name,
           public_phone = v_new.public_phone, public_whatsapp = v_new.public_whatsapp,
           public_email = v_new.public_email, office_address = v_new.office_address,
           office_hours = v_new.office_hours, whatsapp_phone_number_id = v_new.whatsapp_phone_number_id,
           is_active = v_new.is_active, is_site_primary = v_new.is_site_primary
     where id = v_old.id
    returning * into v_new;
  exception when check_violation or unique_violation or not_null_violation then
    get stacked diagnostics v_constraint = constraint_name;
    return jsonb_build_object('ok', false, 'outcome', 'invalid_value', 'field', admin_constraint_field(v_constraint),
                              'reason', case when sqlstate = '23505' then 'in_use' else 'format' end);
  end;

  insert into automation_events (agency_id, event_type, severity, source, details)
  values (v_new.id, 'agency.updated', 'info', 'admin',
          jsonb_build_object('actor', v_actor, 'fields', to_jsonb(v_changed)));
  return jsonb_build_object('ok', true, 'outcome', 'updated', 'agency_id', v_new.id, 'updated_at', v_new.updated_at,
                            'fields', to_jsonb(v_changed));
end;
$$;

-- ------------------------------------------------------------------ agents
create or replace function public.admin_save_agent(
  p_agent_id uuid, p_values jsonb, p_expected_updated_at timestamptz default null, p_actor text default null)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  c_text  constant text[] := array['name', 'whatsapp_phone', 'whatsapp_user_id', 'phone', 'email'];
  v_actor text := admin_actor(p_actor);
  v_old   agents%rowtype;
  v_new   agents%rowtype;
  v_clean jsonb := '{}'::jsonb;
  k       text;
  v       jsonb;
  s       text;
  v_agency agencies%rowtype;
  v_other agents%rowtype;
  v_changed text[] := '{}';
  v_history boolean;
  v_constraint text;
  v_details jsonb;
begin
  if p_values is null or jsonb_typeof(p_values) <> 'object' then
    return jsonb_build_object('ok', false, 'outcome', 'invalid_request', 'reason', 'values_not_object');
  end if;

  for k, v in select * from jsonb_each(p_values) loop
    if k = any (c_text) then
      if jsonb_typeof(v) not in ('string', 'null') then
        return jsonb_build_object('ok', false, 'outcome', 'invalid_value', 'field', k, 'reason', 'type');
      end if;
      s := nullif(btrim(v #>> '{}'), '');
      if k in ('whatsapp_phone', 'phone') then s := admin_normalize_phone(s); end if;
      if k = 'email' then s := lower(s); end if;
      v_clean := v_clean || jsonb_build_object(k, s);
    elsif k = 'is_active' then
      if jsonb_typeof(v) <> 'boolean' then
        return jsonb_build_object('ok', false, 'outcome', 'invalid_value', 'field', k, 'reason', 'type');
      end if;
      v_clean := v_clean || jsonb_build_object(k, v);
    elsif k = 'agency_id' then
      if jsonb_typeof(v) <> 'string' or (v #>> '{}') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        return jsonb_build_object('ok', false, 'outcome', 'invalid_value', 'field', k, 'reason', 'type');
      end if;
      v_clean := v_clean || jsonb_build_object(k, v);
    else
      return jsonb_build_object('ok', false, 'outcome', 'invalid_request', 'reason', 'unknown_field', 'field', k);
    end if;
  end loop;

  if p_agent_id is not null then
    select * into v_old from agents where id = p_agent_id for update;
    if v_old.id is null then
      return jsonb_build_object('ok', false, 'outcome', 'not_found');
    end if;
    v_new := jsonb_populate_record(v_old, v_clean);
  else
    if v_clean ->> 'agency_id' is null then
      return jsonb_build_object('ok', false, 'outcome', 'invalid_value', 'field', 'agency_id', 'reason', 'required');
    end if;
    if v_clean ->> 'name' is null then
      return jsonb_build_object('ok', false, 'outcome', 'invalid_value', 'field', 'name', 'reason', 'required');
    end if;
    v_new := jsonb_populate_record(null::agents, v_clean);
    v_new.is_active := coalesce(v_new.is_active, true);
  end if;

  if v_new.name is null then
    return jsonb_build_object('ok', false, 'outcome', 'invalid_value', 'field', 'name', 'reason', 'required');
  end if;

  -- agency: must exist; new or re-assigned agents only into an ACTIVE agency; an agent with history never moves
  select * into v_agency from agencies where id = v_new.agency_id;
  if v_agency.id is null then
    return jsonb_build_object('ok', false, 'outcome', 'invalid_value', 'field', 'agency_id', 'reason', 'not_found');
  end if;
  if p_agent_id is null or v_new.agency_id is distinct from v_old.agency_id then
    if not v_agency.is_active then
      return jsonb_build_object('ok', false, 'outcome', 'invalid_value', 'field', 'agency_id', 'reason', 'agency_inactive');
    end if;
  end if;
  if p_agent_id is not null and v_new.agency_id is distinct from v_old.agency_id then
    v_history := exists (select 1 from properties where agent_id = v_old.id)
              or exists (select 1 from submission_sessions where agent_id = v_old.id)
              or exists (select 1 from whatsapp_messages where agent_id = v_old.id);
    if v_history then
      return jsonb_build_object('ok', false, 'outcome', 'invalid_value', 'field', 'agency_id',
                                'reason', 'agent_has_history');
    end if;
  end if;

  -- identities: one owner each, across ALL agencies (stricter than the per-agency phone index on purpose)
  if v_new.whatsapp_user_id is not null then
    select * into v_other from agents where whatsapp_user_id = v_new.whatsapp_user_id and id is distinct from p_agent_id;
    if v_other.id is not null then
      return jsonb_build_object('ok', false, 'outcome', 'invalid_value', 'field', 'whatsapp_user_id',
                                'reason', 'in_use', 'other_agent', v_other.name);
    end if;
  end if;
  if v_new.whatsapp_phone is not null then
    select * into v_other from agents where whatsapp_phone = v_new.whatsapp_phone and id is distinct from p_agent_id
     limit 1;
    if v_other.id is not null then
      return jsonb_build_object('ok', false, 'outcome', 'invalid_value', 'field', 'whatsapp_phone',
                                'reason', 'in_use', 'other_agent', v_other.name);
    end if;
  end if;

  if p_agent_id is null then
    begin
      insert into agents (agency_id, name, whatsapp_phone, whatsapp_user_id, phone, email, is_active)
      values (v_new.agency_id, v_new.name, v_new.whatsapp_phone, v_new.whatsapp_user_id, v_new.phone, v_new.email,
              v_new.is_active)
      returning * into v_new;
    exception when check_violation or unique_violation or not_null_violation then
      get stacked diagnostics v_constraint = constraint_name;
      return jsonb_build_object('ok', false, 'outcome', 'invalid_value', 'field', admin_constraint_field(v_constraint),
                                'reason', case when sqlstate = '23505' then 'in_use' else 'format' end);
    end;
    insert into automation_events (agency_id, event_type, severity, source, details)
    values (v_new.agency_id, 'agent.created', 'info', 'admin',
            jsonb_strip_nulls(jsonb_build_object('actor', v_actor, 'agent_id', v_new.id, 'active', v_new.is_active,
              'whatsapp_user_id', case when v_new.whatsapp_user_id is not null then 'set' end,
              'whatsapp_phone', case when v_new.whatsapp_phone is not null then 'set' end)));
    return jsonb_build_object('ok', true, 'outcome', 'created', 'agent_id', v_new.id, 'updated_at', v_new.updated_at);
  end if;

  select coalesce(array_agg(key order by key), '{}') into v_changed
    from jsonb_each(to_jsonb(v_new)) n
   where key = any (c_text || array['is_active', 'agency_id']) and n.value is distinct from to_jsonb(v_old) -> key;
  if cardinality(v_changed) = 0 then
    return jsonb_build_object('ok', true, 'outcome', 'unchanged', 'agent_id', v_old.id, 'updated_at', v_old.updated_at);
  end if;
  if p_expected_updated_at is distinct from v_old.updated_at then
    return jsonb_build_object('ok', false, 'outcome', 'stale', 'updated_at', v_old.updated_at);
  end if;

  begin
    update agents
       set agency_id = v_new.agency_id, name = v_new.name, whatsapp_phone = v_new.whatsapp_phone,
           whatsapp_user_id = v_new.whatsapp_user_id, phone = v_new.phone, email = v_new.email,
           is_active = v_new.is_active
     where id = v_old.id
    returning * into v_new;
  exception when check_violation or unique_violation or not_null_violation then
    get stacked diagnostics v_constraint = constraint_name;
    return jsonb_build_object('ok', false, 'outcome', 'invalid_value', 'field', admin_constraint_field(v_constraint),
                              'reason', case when sqlstate = '23505' then 'in_use' else 'format' end);
  end;

  -- audit: field names and identity transitions, never identity values
  v_details := jsonb_strip_nulls(jsonb_build_object(
    'actor', v_actor, 'agent_id', v_new.id, 'fields', to_jsonb(v_changed),
    'whatsapp_user_id', case when 'whatsapp_user_id' = any (v_changed) then
                          case when v_old.whatsapp_user_id is null then 'set'
                               when v_new.whatsapp_user_id is null then 'removed' else 'changed' end end,
    'whatsapp_phone', case when 'whatsapp_phone' = any (v_changed) then
                        case when v_old.whatsapp_phone is null then 'set'
                             when v_new.whatsapp_phone is null then 'removed' else 'changed' end end,
    'published_listings', case when v_old.is_active and not v_new.is_active then
                            (select count(*) from properties where agent_id = v_new.id and listing_status = 'published') end));
  insert into automation_events (agency_id, event_type, severity, source, details)
  values (v_new.agency_id,
          case when v_old.is_active and not v_new.is_active then 'agent.deactivated'
               when not v_old.is_active and v_new.is_active then 'agent.activated'
               else 'agent.updated' end,
          'info', 'admin', v_details);
  return jsonb_build_object('ok', true, 'outcome', 'updated', 'agent_id', v_new.id, 'updated_at', v_new.updated_at,
                            'fields', to_jsonb(v_changed));
end;
$$;

-- Registers the identity (BSUID, else phone) of a STORED direct message on an agent: no typing, no invented values.
-- Historical messages are not reprocessed; the agent's next message resolves normally.
create or replace function public.admin_link_agent_identity(
  p_agent_id uuid, p_message_id uuid, p_expected_updated_at timestamptz default null, p_actor text default null)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_actor text := admin_actor(p_actor);
  g       agents%rowtype;
  m       whatsapp_messages%rowtype;
  v_other uuid;
  v_via   text;
begin
  select * into g from agents where id = p_agent_id for update;
  if g.id is null then
    return jsonb_build_object('ok', false, 'outcome', 'not_found', 'reason', 'agent');
  end if;
  select * into m from whatsapp_messages where id = p_message_id;
  if m.id is null then
    return jsonb_build_object('ok', false, 'outcome', 'not_found', 'reason', 'message');
  end if;
  if m.conversation_type is distinct from 'direct' then
    return jsonb_build_object('ok', false, 'outcome', 'invalid_request', 'reason', 'not_direct_message');
  end if;
  if m.agency_id is distinct from g.agency_id then
    return jsonb_build_object('ok', false, 'outcome', 'invalid_request', 'reason', 'agency_mismatch');
  end if;
  if m.agent_id is not null and m.agent_id <> g.id then
    return jsonb_build_object('ok', false, 'outcome', 'invalid_request', 'reason', 'identity_conflict');
  end if;

  if m.sender_user_id is not null then
    v_via := 'whatsapp_user_id';
    if g.whatsapp_user_id = m.sender_user_id then
      return jsonb_build_object('ok', true, 'outcome', 'already', 'agent_id', g.id, 'updated_at', g.updated_at);
    end if;
    if g.whatsapp_user_id is not null
       or (g.whatsapp_phone is not null and m.sender_phone is not null and g.whatsapp_phone <> m.sender_phone) then
      return jsonb_build_object('ok', false, 'outcome', 'invalid_request', 'reason', 'identity_conflict');
    end if;
    select id into v_other from agents where whatsapp_user_id = m.sender_user_id and id <> g.id;
  elsif m.sender_phone is not null then
    v_via := 'whatsapp_phone';
    if g.whatsapp_phone = m.sender_phone then
      return jsonb_build_object('ok', true, 'outcome', 'already', 'agent_id', g.id, 'updated_at', g.updated_at);
    end if;
    if g.whatsapp_phone is not null then
      return jsonb_build_object('ok', false, 'outcome', 'invalid_request', 'reason', 'identity_conflict');
    end if;
    select id into v_other from agents where whatsapp_phone = m.sender_phone and id <> g.id limit 1;
  else
    return jsonb_build_object('ok', false, 'outcome', 'invalid_request', 'reason', 'no_identity');
  end if;
  if v_other is not null then
    return jsonb_build_object('ok', false, 'outcome', 'invalid_request', 'reason', 'identity_in_use');
  end if;
  if p_expected_updated_at is distinct from g.updated_at then
    return jsonb_build_object('ok', false, 'outcome', 'stale', 'updated_at', g.updated_at);
  end if;

  if v_via = 'whatsapp_user_id' then
    update agents set whatsapp_user_id = m.sender_user_id where id = g.id returning * into g;
  else
    update agents set whatsapp_phone = m.sender_phone where id = g.id returning * into g;
  end if;

  insert into automation_events (agency_id, event_type, severity, source, message_id, details)
  values (g.agency_id, 'agent.identity_linked', 'info', 'admin', m.id,
          jsonb_build_object('actor', v_actor, 'agent_id', g.id, 'via', v_via));
  return jsonb_build_object('ok', true, 'outcome', 'linked', 'agent_id', g.id, 'via', v_via, 'updated_at', g.updated_at);
end;
$$;

-- ------------------------------------------------------------------ privileges: service role only
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.contact_is_placeholder(text)', 'public.admin_normalize_phone(text)', 'public.admin_constraint_field(text)',
    'public.admin_save_agency(uuid, jsonb, timestamptz, text)', 'public.admin_save_agent(uuid, jsonb, timestamptz, text)',
    'public.admin_link_agent_identity(uuid, uuid, timestamptz, text)']
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;
