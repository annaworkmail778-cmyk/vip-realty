-- =============================================================================
-- WhatsApp group listings in any order ("bursts").
--
-- An agent may send a listing as: text then photos, photos then text, text + photos + address, several texts...
--   * Every photo is stored by n8n as soon as it arrives in property-images/inbox/<media_id>.<ext> and marked
--     whatsapp_media.status_reason = 'demo_inbox'. Nothing is public until it is attached to a listing.
--   * demo_open_next_burst(): the messages of one registered agent in the group that follow each other with gaps
--     of at most 5 minutes form a burst. When the agent has been quiet for 2 minutes and the burst contains a
--     listing text (listing_text_plausible), the FIRST listing text opens a session together with every text and
--     photo of the burst that is closer in time to it than to another listing text of the burst. Texts go to the
--     extraction (several messages = one listing); photos are claimed for that session.
--   * demo_photos_to_attach(): photos claimed by a session whose draft exists, plus late photos (sent within 20
--     minutes after the agent's last listing, with no new listing text around them) are leased to n8n, which moves
--     each file to properties/<property_id>/<media_id>.<ext> and calls demo_record_photo().
--   * demo_record_photo(): checks the moved file exists, inserts property_images with a free sort_order (send
--     order, first photo = cover) and marks the media attached.
-- Replaces demo_next_listing_message / demo_open_listing_session / demo_adopt_group_media in the workflows (those
-- functions are kept, unused, for rollback).
-- =============================================================================

create or replace function public.demo_media_ext(p_mime text)
returns text language sql immutable set search_path = pg_catalog, pg_temp as $$
  select case lower(split_part(coalesce(p_mime, ''), ';', 1))
           when 'image/jpeg' then 'jpg' when 'image/jpg' then 'jpg'
           when 'image/png' then 'png' when 'image/webp' then 'webp' end
$$;

-- ------------------------------------------------------------------ open the next ready burst
create or replace function public.demo_open_next_burst(p_worker text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_worker  text := left(nullif(btrim(p_worker), ''), 200);
  b         record;
  l         record;
  v_session uuid;
  v_key     text;
  v_texts   integer;
  v_photos  integer;
begin
  -- one opener at a time (overlapping n8n runs)
  perform pg_advisory_xact_lock(hashtext('vip_demo_open_burst'));

  create temp table if not exists _burst_items (
    id uuid, channel_id uuid, agency_id uuid, agent_id uuid, sender_jid text, group_jid text,
    message_type text, ts timestamptz, received_at timestamptz, is_listing boolean, burst bigint) on commit drop;
  truncate _burst_items;

  insert into _burst_items
  with items as (
    select m.id, m.channel_id, c.agency_id, ai.agent_id, m.sender_jid, c.group_jid, m.message_type,
           coalesce(m.provider_timestamp, m.received_at) ts, m.received_at,
           (m.message_type = 'text' and public.listing_text_plausible(m.body)) is_listing
      from whatsapp_messages m
      join whatsapp_channels c on c.id = m.channel_id and c.provider = 'evolution' and c.is_active
      join agent_identities ai on ai.is_active and ai.provider = 'evolution' and ai.identity = m.sender_jid
                              and ai.agency_id = c.agency_id
      join agents a on a.id = ai.agent_id and a.is_active
     where m.provider = 'evolution'
       and m.conversation_type = 'group'
       and m.group_id = c.group_jid
       and m.agency_id = c.agency_id
       and m.session_id is null
       and m.processing_status = 'ignored'
       and m.received_at > now() - interval '6 hours'
       and not exists (select 1 from demo_listing_claims d where d.message_id = m.id)
       and ((m.message_type = 'text' and nullif(btrim(coalesce(m.body, '')), '') is not null)
            or (m.message_type = 'image' and exists (select 1 from whatsapp_media wm
                                                       where wm.message_id = m.id and wm.status_reason = 'demo_inbox')))
  ), g as (
    select i.*, case when lag(i.ts) over w is null or i.ts - lag(i.ts) over w > interval '5 minutes' then 1 else 0 end brk
      from items i window w as (partition by i.channel_id, i.sender_jid order by i.ts, i.received_at, i.id)
  )
  select id, channel_id, agency_id, agent_id, sender_jid, group_jid, message_type, ts, received_at, is_listing,
         sum(brk) over (partition by channel_id, sender_jid order by ts, received_at, id)
    from g;

  -- the oldest burst that contains a listing text and has been quiet for 2 minutes
  select channel_id, sender_jid, burst, min(ts) first_ts
    into b
    from _burst_items
   group by channel_id, sender_jid, burst
  having bool_or(is_listing) and max(ts) < now() - interval '2 minutes' and max(received_at) < now() - interval '2 minutes'
   order by min(ts)
   limit 1;

  if b.channel_id is null then
    return jsonb_build_object('ok', true, 'outcome', 'none');
  end if;

  -- its first listing text
  select * into l from _burst_items
   where channel_id = b.channel_id and sender_jid = b.sender_jid and burst = b.burst and is_listing
   order by ts, received_at, id limit 1;

  v_key := left('demo:evo:' || l.group_jid || ':' || l.sender_jid, 200);
  insert into submission_sessions (agency_id, agent_id, channel, channel_conversation_key, kind,
                                   status, started_at, last_message_at, process_after)
  values (l.agency_id, l.agent_id, 'whatsapp', v_key, 'create', 'open', l.received_at, l.received_at, now())
  returning id into v_session;
  update submission_sessions set status = 'ready', process_after = now() where id = v_session;

  -- every item of the burst whose nearest listing text is this one (ties go to the earlier listing)
  create temp table if not exists _burst_mine (id uuid, message_type text) on commit drop;
  truncate _burst_mine;
  insert into _burst_mine
  select i.id, i.message_type
    from _burst_items i
   where i.channel_id = b.channel_id and i.sender_jid = b.sender_jid and i.burst = b.burst
     and (i.id = l.id or not i.is_listing)
     and (select x.id from _burst_items x
           where x.channel_id = b.channel_id and x.sender_jid = b.sender_jid and x.burst = b.burst and x.is_listing
           order by abs(extract(epoch from (x.ts - i.ts))), x.ts, x.received_at, x.id
           limit 1) = l.id;

  update whatsapp_messages m
     set session_id = v_session, agent_id = l.agent_id, processing_status = 'buffered'
    from _burst_mine t
   where m.id = t.id and t.message_type = 'text';

  insert into demo_listing_claims (message_id, session_id, agency_id, agent_id, claimed_by)
  select t.id, v_session, l.agency_id, l.agent_id, v_worker from _burst_mine t
  on conflict (message_id) do nothing;

  select count(*) filter (where message_type = 'text'), count(*) filter (where message_type = 'image')
    into v_texts, v_photos from _burst_mine;

  insert into automation_events (agency_id, event_type, severity, source, session_id, message_id, details)
  values (l.agency_id, 'demo.listing_promoted', 'info', 'n8n', v_session, l.id,
          jsonb_build_object('mode', 'burst', 'agent_id', l.agent_id, 'texts', v_texts, 'photos', v_photos,
                             'worker', v_worker));

  return jsonb_build_object('ok', true, 'outcome', 'opened', 'session_id', v_session, 'message_id', l.id,
                            'agent_id', l.agent_id, 'texts', v_texts, 'photos', v_photos);
end;
$function$;

-- ------------------------------------------------------------------ lease photos that can be attached
create or replace function public.demo_photos_to_attach(p_property_ids uuid[] default null, p_limit integer default 30)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_out jsonb;
begin
  perform pg_advisory_xact_lock(hashtext('vip_demo_attach_photos'));

  -- expired leases go back to the inbox
  update whatsapp_media set status_reason = 'demo_inbox', updated_at = now()
   where status_reason = 'demo_attaching' and updated_at < now() - interval '5 minutes';

  -- late photos (no own listing text around them) join the agent's previous listing, sent at most 20 min earlier
  if p_property_ids is null then
    insert into demo_listing_claims (message_id, session_id, agency_id, agent_id, claimed_by)
    select m.id, prev.session_id, m.agency_id, prev.agent_id, 'late-photo'
      from whatsapp_messages m
      join whatsapp_media wm on wm.message_id = m.id and wm.status_reason = 'demo_inbox'
      cross join lateral (
        select d.session_id, d.agent_id
          from whatsapp_messages t
          join demo_listing_claims d on d.message_id = t.id
          join submission_sessions s on s.id = d.session_id and s.status = 'completed'
         where t.channel_id = m.channel_id and t.sender_jid = m.sender_jid and t.message_type = 'text'
           and public.listing_text_plausible(t.body)
           and coalesce(t.provider_timestamp, t.received_at) < coalesce(m.provider_timestamp, m.received_at)
           and coalesce(t.provider_timestamp, t.received_at) >= coalesce(m.provider_timestamp, m.received_at) - interval '20 minutes'
         order by coalesce(t.provider_timestamp, t.received_at) desc limit 1) prev
     where m.provider = 'evolution' and m.message_type = 'image' and m.session_id is null
       and m.received_at < now() - interval '5 minutes'
       and m.received_at > now() - interval '6 hours'
       and not exists (select 1 from demo_listing_claims d where d.message_id = m.id)
       and not exists (select 1 from whatsapp_messages t
                        where t.channel_id = m.channel_id and t.sender_jid = m.sender_jid and t.message_type = 'text'
                          and public.listing_text_plausible(t.body)
                          and coalesce(t.provider_timestamp, t.received_at) >= coalesce(m.provider_timestamp, m.received_at)
                          and coalesce(t.provider_timestamp, t.received_at) <= coalesce(m.provider_timestamp, m.received_at) + interval '5 minutes')
    on conflict (message_id) do nothing;
  end if;

  with ready as (
    select wm.id media_id, wm.mime_type, wm.width, wm.height, p.id property_id, p.created_at,
           coalesce(m.provider_timestamp, m.received_at) ts, d.claimed_by
      from whatsapp_media wm
      join whatsapp_messages m on m.id = wm.message_id and m.message_type = 'image'
      join demo_listing_claims d on d.message_id = m.id
      join submission_sessions s on s.id = d.session_id and s.status = 'completed'
      join properties p on p.created_from_session_id = s.id and p.listing_status in ('draft', 'published')
     where wm.status_reason = 'demo_inbox'
       and public.demo_media_ext(wm.mime_type) is not null
       and (p_property_ids is null and p.created_at < now() - interval '2 minutes'
            or p.id = any(p_property_ids))
     order by p.id, ts
     limit greatest(1, least(p_limit, 100))
  ), leased as (
    update whatsapp_media wm
       set status_reason = 'demo_attaching', target_property_id = r.property_id, updated_at = now()
      from ready r
     where wm.id = r.media_id
    returning wm.id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'media_id', r.media_id,
           'property_id', r.property_id,
           'inbox_path', 'inbox/' || r.media_id || '.' || public.demo_media_ext(r.mime_type),
           'dest_path', 'properties/' || r.property_id || '/' || r.media_id || '.' || public.demo_media_ext(r.mime_type),
           'late', r.claimed_by = 'late-photo' or r.created_at < now() - interval '2 minutes')
         order by r.property_id, r.ts), '[]'::jsonb)
    into v_out
    from ready r join leased x on x.id = r.media_id;

  return jsonb_build_object('ok', true, 'photos', v_out);
end;
$function$;

-- ------------------------------------------------------------------ record one moved photo
create or replace function public.demo_record_photo(p_media_id uuid, p_property_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  wm      whatsapp_media%rowtype;
  m       whatsapp_messages%rowtype;
  p       properties%rowtype;
  v_path  text;
  v_sort  integer;
begin
  select * into wm from whatsapp_media where id = p_media_id for update;
  if wm.id is null or wm.status_reason <> 'demo_attaching' or wm.target_property_id is distinct from p_property_id then
    return jsonb_build_object('ok', false, 'reason', 'not_leased');
  end if;
  select * into m from whatsapp_messages where id = wm.message_id;
  select * into p from properties where id = p_property_id;
  if p.id is null then
    return jsonb_build_object('ok', false, 'reason', 'property_missing');
  end if;

  v_path := 'properties/' || p.id || '/' || wm.id || '.' || public.demo_media_ext(wm.mime_type);
  if not exists (select 1 from storage.objects o where o.bucket_id = 'property-images' and o.name = v_path) then
    update whatsapp_media set status_reason = 'demo_inbox', updated_at = now() where id = wm.id;
    return jsonb_build_object('ok', false, 'reason', 'file_not_moved');
  end if;

  if not exists (select 1 from property_images where storage_path = v_path) then
    v_sort := greatest(0, (extract(epoch from coalesce(m.provider_timestamp, m.received_at)) - 1767225600)::integer) * 20;
    while exists (select 1 from property_images where property_id = p.id and sort_order = v_sort) loop
      v_sort := v_sort + 1;
    end loop;
    insert into property_images (agency_id, property_id, media_id, storage_path, sort_order, is_primary, width, height)
    values (p.agency_id, p.id, null, v_path, v_sort, false, wm.width, wm.height);
  end if;

  update whatsapp_messages set session_id = p.created_from_session_id, agent_id = coalesce(agent_id, p.agent_id)
   where id = m.id and session_id is null;
  update whatsapp_media set download_status = 'skipped', status_reason = 'demo_attached_directly', updated_at = now()
   where id = wm.id;

  return jsonb_build_object('ok', true, 'property_id', p.id, 'storage_path', v_path);
end;
$function$;

revoke all on function public.demo_open_next_burst(text) from public, anon, authenticated;
revoke all on function public.demo_photos_to_attach(uuid[], integer) from public, anon, authenticated;
revoke all on function public.demo_record_photo(uuid, uuid) from public, anon, authenticated;
grant execute on function public.demo_open_next_burst(text) to service_role;
grant execute on function public.demo_photos_to_attach(uuid[], integer) to service_role;
grant execute on function public.demo_record_photo(uuid, uuid) to service_role;
