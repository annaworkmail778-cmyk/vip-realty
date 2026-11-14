-- =============================================================================
-- WhatsApp group: every registered agent, only listings, the agent's own number on the website.
--
-- 1. Listing filter. listing_text_plausible(body) is a conservative pre-filter for the WhatsApp group:
--    a text becomes a listing candidate only if it is at least 30 characters, contains a digit, a price,
--    area or room count, and a property or deal word (Armenian, Russian, English, transliterated). Greetings,
--    congratulations, short chat, voice notes, stickers and photos without text never reach the AI.
--    The Telegram approval step remains the final filter: nothing is published without the admin.
-- 2. demo_next_listing_message / demo_open_listing_session apply the filter (same allowlist otherwise).
-- 3. demo_adopt_group_media no longer hard-codes one sender: a photo is attached when its sender is an
--    ACTIVE registered agent of the channel's agency (agent_identities) and it follows that same agent's
--    listing text in the channel's group within 15 minutes. Photos from anyone else are refused
--    ('sender_not_linked'). All other rules are unchanged.
-- 4. Public agent contact. published_property_listings gains agent_name, agent_phone, agent_whatsapp
--    (appended) for listings whose agent is active; anonymous readers may read exactly those agent
--    columns of agents who have a published listing. The website shows the agent's number on the
--    listing page and falls back to the agency number when the agent has none.
--
-- Rollback: re-create the three functions from production-snapshot (2026-11-14) definitions, re-create
-- published_property_listings without the three columns (drop view + create, then re-grant select to
-- anon, authenticated), drop policy agents_public_read_listing_agents, revoke the column grants and
-- drop function listing_text_plausible.
-- =============================================================================

-- ------------------------------------------------------------------ 1. listing filter
create or replace function public.listing_text_plausible(p_body text)
returns boolean
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select p_body is not null
     and char_length(btrim(p_body)) >= 30
     and p_body ~ '[0-9]'
     -- a hard listing fact: price / currency, area, room count or land unit
     and p_body ~* concat(
       '(\$|֏|€|usd|amd|eur|rub|dram|դրամ|դոլար|руб|долл|евро',
       '|[0-9]\s*(k|к)([^[:alpha:]]|$)|[0-9]\s*(հազ|тыс|млн|mln|միլ)',
       '|քմ|ք\.\s?մ|кв\.?\s?м|м2|м²|m2|m²|sqm|sq\.?\s?m|qm|kv\.?\s?m',
       '|[0-9]\s*-?\s*(սենյակ|senyak|комн|room|ս/)',
       '|սոտկա|сотк|sotk|հեկտար|гектар|hectare)')
     -- and a property or deal word
     and p_body ~* concat(
       '(վաճառ|vachar|прода|prodae|sale|sell|վարձ|vardz|аренд|сда|sdae|rent',
       '|բնակարան|bnakaran|квартир|kvartir|apartment|flat|առանձնատ|особняк|дом|dom|house|villa|տուն|tun',
       '|հող|hox|hogh|участ|земл|land|հարկ|hark|этаж|floor|գրասենյակ|офис|office|կոմերց|коммерч|commercial',
       '|ավտոտնակ|гараж|garage|սենյակ|senyak|комнат|room)')
$$;

comment on function public.listing_text_plausible(text) is
  'Pre-filter for WhatsApp group texts: >= 30 chars, a digit, a hard listing fact (price/currency, area, '
  'room count, land unit) and a property/deal word. Greetings and chat never become listing sessions.';

-- ------------------------------------------------------------------ 2. next listing message (filtered)
create or replace function public.demo_next_listing_message()
returns jsonb
language plpgsql
stable
set search_path to 'public', 'pg_temp'
as $function$
declare
  r record;
begin
  select m.id, m.provider_message_id, m.sender_jid, m.message_type, m.received_at,
         ai.agent_id, c.agency_id, c.group_jid, c.instance_name
    into r
    from whatsapp_messages m
    join whatsapp_channels c
      on c.id = m.channel_id and c.provider = 'evolution' and c.is_active
    join agent_identities ai
      on ai.is_active and ai.provider = 'evolution' and ai.identity = m.sender_jid
     and ai.agency_id = c.agency_id
   where m.provider = 'evolution'
     and m.conversation_type = 'group'
     and m.session_id is null
     and m.processing_status = 'ignored'
     and m.received_at >= timestamptz '2026-09-25 16:43:29.336389+00'
     and nullif(btrim(coalesce(m.body, '')), '') is not null
     and public.listing_text_plausible(m.body)
     and not exists (
       select 1
       from demo_listing_claims d
       where d.message_id = m.id
     )
   order by m.provider_timestamp, m.received_at, m.id
   limit 1;

  if r.id is null then
    return jsonb_build_object('ok', true, 'found', false);
  end if;

  return jsonb_build_object(
    'ok', true,
    'found', true,
    'message_id', r.id,
    'provider_message_id', r.provider_message_id,
    'sender_jid', r.sender_jid,
    'message_type', r.message_type,
    'agent_id', r.agent_id,
    'agency_id', r.agency_id,
    'group_jid', r.group_jid,
    'instance', r.instance_name
  );
end;
$function$;

-- ------------------------------------------------------------------ 2b. open session (same filter)
create or replace function public.demo_open_listing_session(p_message_id uuid, p_worker text default null::text)
returns jsonb
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_worker  text := left(nullif(btrim(p_worker), ''), 200);
  m         whatsapp_messages%rowtype;
  c         whatsapp_channels%rowtype;
  v_agent   uuid;
  v_key     text;
  v_session uuid;
  v_existing uuid;
begin
  if p_message_id is null then
    return jsonb_build_object('ok', false, 'outcome', 'invalid_request', 'reason', 'missing_message_id');
  end if;

  select d.session_id into v_existing from demo_listing_claims d where d.message_id = p_message_id;
  if v_existing is not null then
    return jsonb_build_object('ok', true, 'outcome', 'already', 'session_id', v_existing,
                              'message_id', p_message_id);
  end if;

  select * into m from whatsapp_messages where id = p_message_id for update;
  if m.id is null then
    return jsonb_build_object('ok', false, 'outcome', 'not_found', 'reason', 'message');
  end if;

  -- ---------------------------------------------------------------- allowlist (all or nothing)
  if m.provider <> 'evolution' then
    return jsonb_build_object('ok', false, 'outcome', 'rejected', 'reason', 'not_evolution');
  end if;
  if m.conversation_type is distinct from 'group' or m.sender_jid is null or m.channel_id is null then
    return jsonb_build_object('ok', false, 'outcome', 'rejected', 'reason', 'not_group_message');
  end if;

  select * into c from whatsapp_channels
   where id = m.channel_id and provider = 'evolution' and is_active;
  if c.id is null then
    return jsonb_build_object('ok', false, 'outcome', 'rejected', 'reason', 'channel_not_allowed');
  end if;
  if m.agency_id is distinct from c.agency_id or m.group_id is distinct from c.group_jid then
    return jsonb_build_object('ok', false, 'outcome', 'rejected', 'reason', 'channel_mismatch');
  end if;

  select ai.agent_id into v_agent
    from agent_identities ai
   where ai.is_active and ai.provider = 'evolution' and ai.identity = m.sender_jid
     and ai.agency_id = c.agency_id;
  if v_agent is null then
    return jsonb_build_object('ok', false, 'outcome', 'rejected', 'reason', 'sender_not_linked');
  end if;

  if m.session_id is not null or m.processing_status <> 'ignored' then
    return jsonb_build_object('ok', false, 'outcome', 'rejected', 'reason', 'already_processed');
  end if;
  if nullif(btrim(coalesce(m.body, '')), '') is null then
    return jsonb_build_object('ok', false, 'outcome', 'rejected', 'reason', 'no_listing_text');
  end if;
  if not public.listing_text_plausible(m.body) then
    return jsonb_build_object('ok', false, 'outcome', 'rejected', 'reason', 'not_a_listing');
  end if;

  -- ---------------------------------------------------------------- create the session
  -- Insert 'open', then the only legal transition open -> ready (submission_sessions_status_transition_trg).
  v_key := left('demo:evo:' || c.group_jid || ':' || m.sender_jid, 200);

  insert into submission_sessions (agency_id, agent_id, channel, channel_conversation_key, kind,
                                   status, started_at, last_message_at, process_after)
  values (c.agency_id, v_agent, 'whatsapp', v_key, 'create',
          'open', m.received_at, m.received_at, now())
  returning id into v_session;

  update submission_sessions
     set status = 'ready', process_after = now()
   where id = v_session;

  update whatsapp_messages
     set session_id = v_session, agent_id = v_agent, processing_status = 'buffered'
   where id = m.id;

  insert into demo_listing_claims (message_id, session_id, agency_id, agent_id, claimed_by)
  values (m.id, v_session, c.agency_id, v_agent, v_worker);

  insert into automation_events (agency_id, event_type, severity, source, session_id, message_id, details)
  values (c.agency_id, 'demo.listing_promoted', 'info', 'n8n', v_session, m.id,
          jsonb_build_object('mode', 'broker_demo', 'agent_id', v_agent, 'worker', v_worker));

  return jsonb_build_object('ok', true, 'outcome', 'opened', 'session_id', v_session,
                            'message_id', m.id, 'agent_id', v_agent, 'agency_id', c.agency_id);
end;
$function$;

-- ------------------------------------------------------------------ 3. photos from every registered agent
create or replace function public.demo_adopt_group_media(p_media_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_media       whatsapp_media%rowtype;
  v_msg         whatsapp_messages%rowtype;
  v_chan        whatsapp_channels%rowtype;
  v_sender      uuid;
  v_session_id  uuid;
  v_agent_id    uuid;
  v_property_id uuid;
  v_count       integer;
begin
  select * into v_media from whatsapp_media where id = p_media_id for update;
  if v_media.id is null then
    return jsonb_build_object('ok', false, 'reason', 'media_missing');
  end if;

  select * into v_msg from whatsapp_messages where id = v_media.message_id for update;

  if v_msg.id is not null then
    select * into v_chan from whatsapp_channels
     where id = v_msg.channel_id and provider = 'evolution' and is_active;
  end if;

  -- Allowlist: an image in the agency's active Evolution group channel.
  if v_msg.id is null
     or v_chan.id is null
     or v_msg.provider <> 'evolution'
     or v_media.provider <> 'evolution'
     or v_msg.agency_id is distinct from v_chan.agency_id
     or v_media.agency_id is distinct from v_chan.agency_id
     or v_msg.conversation_type <> 'group'
     or v_msg.group_id is distinct from v_chan.group_jid
     or v_msg.sender_jid is null
     or v_msg.message_type <> 'image'
     or not media_is_image(v_msg.message_type, v_media.mime_type)
  then
    return jsonb_build_object('ok', false, 'reason', 'not_demo_media');
  end if;

  -- The sender must be an active registered agent of this agency.
  select ai.agent_id into v_sender
    from agent_identities ai
    join agents a on a.id = ai.agent_id and a.is_active
   where ai.is_active and ai.provider = 'evolution' and ai.identity = v_msg.sender_jid
     and ai.agency_id = v_chan.agency_id;
  if v_sender is null then
    return jsonb_build_object('ok', false, 'reason', 'sender_not_linked');
  end if;

  -- Idempotent retry.
  if v_msg.session_id is not null and v_msg.agent_id is not null then
    return jsonb_build_object('ok', true, 'outcome', 'already_adopted',
                              'session_id', v_msg.session_id, 'agent_id', v_msg.agent_id);
  end if;

  -- Exactly one valid listing of THIS agent in THIS group whose text precedes the photo by <= 15 min.
  select count(*),
         min(s.id::text)::uuid,
         min(s.agent_id::text)::uuid,
         min(p.id::text)::uuid
    into v_count, v_session_id, v_agent_id, v_property_id
    from submission_sessions s
    join properties p on p.created_from_session_id = s.id
   where s.agency_id = v_chan.agency_id
     and s.agent_id = v_sender
     and s.channel = 'whatsapp'
     and s.channel_conversation_key = left('demo:evo:' || v_chan.group_jid || ':' || v_msg.sender_jid, 200)
     and s.status = 'completed'
     and p.agency_id = s.agency_id
     and p.agent_id = s.agent_id
     and p.source = 'whatsapp'
     and p.listing_status in ('draft', 'published')
     and coalesce(v_msg.provider_timestamp, v_msg.received_at) >= s.last_message_at
     and coalesce(v_msg.provider_timestamp, v_msg.received_at) <= s.last_message_at + interval '15 minutes'
     and exists (
       select 1 from extraction_results er
        where er.session_id = s.id and er.property_id = p.id
          and er.status = 'succeeded' and er.validation_status = 'valid'
     );

  if v_count = 0 then
    return jsonb_build_object('ok', false, 'reason', 'no_candidate');
  end if;
  if v_count <> 1 then
    return jsonb_build_object('ok', false, 'reason', 'ambiguous_candidate', 'candidate_count', v_count);
  end if;

  update whatsapp_messages set agent_id = v_agent_id, session_id = v_session_id where id = v_msg.id;

  update whatsapp_media
     set download_status      = 'received',
         status_reason        = 'demo_group_adopted',
         last_error           = null,
         failed_stage         = null,
         next_attempt_at      = null,
         lease_attempt_id     = null,
         lease_expires_at     = null,
         lease_worker         = null,
         download_deadline_at = greatest(download_deadline_at, now() + interval '15 minutes')
   where id = v_media.id;

  return jsonb_build_object('ok', true, 'outcome', 'adopted', 'media_id', v_media.id, 'message_id', v_msg.id,
                            'agent_id', v_agent_id, 'session_id', v_session_id, 'property_id', v_property_id);
end;
$function$;

-- ------------------------------------------------------------------ 4. public agent contact
grant select (agent_id) on public.properties to anon, authenticated;
grant select (id, name, phone, whatsapp_phone, is_active) on public.agents to anon, authenticated;

create policy agents_public_read_listing_agents on public.agents
  for select to anon, authenticated
  using (is_active and exists (
    select 1 from public.properties p
     where p.agent_id = agents.id and p.listing_status = 'published'));

create or replace view public.published_property_listings
with (security_invoker = true) as
select p.id, p.slug, p.title, p.description, p.intent, p.property_type, p.country, p.city, p.district,
       p.price, p.currency, p.price_period, p.price_negotiable, p.area_sqm, p.land_area_sqm, p.rooms,
       p.bedrooms, p.bathrooms, p.floor, p.total_floors, p.year_built, p.features, p.featured,
       p.published_at, p.updated_at,
       cover.storage_path as primary_image_path,
       coalesce(gallery.images, '[]'::jsonb) as images,
       ag.name as agent_name, ag.phone as agent_phone, ag.whatsapp_phone as agent_whatsapp
  from properties p
  left join lateral (
    select i.storage_path from property_images i
     where i.property_id = p.id
     order by i.is_primary desc, i.sort_order
     limit 1) cover on true
  left join lateral (
    select jsonb_agg(jsonb_build_object('id', i.id, 'storage_path', i.storage_path, 'sort_order', i.sort_order,
                                        'alt_text', i.alt_text, 'is_primary', i.is_primary, 'width', i.width,
                                        'height', i.height) order by i.sort_order) as images
      from property_images i
     where i.property_id = p.id) gallery on true
  left join lateral (
    select a.name, a.phone, a.whatsapp_phone from agents a
     where a.id = p.agent_id and a.is_active) ag on true
 where p.listing_status = 'published';
