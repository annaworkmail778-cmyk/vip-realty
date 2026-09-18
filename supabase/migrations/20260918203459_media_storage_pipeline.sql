-- =============================================================================
-- Phase 7 — WhatsApp media download, storage and property images
--
-- whatsapp_media gets a full, lease-based state machine:
--
--   received ─claim→ downloading ─complete→ downloaded ─claim→ validating ─verdict→ validated ─claim→ attaching
--        │                │                                        │                   │               │
--        │                └→ (retry) received / expired / failed   └→ rejected         │   complete ─→ uploaded ─→ attached
--        ├→ skipped  (never downloaded: unresolved sender, group, ignored message, not an image)   (held: waits for a draft)
--        └→ expired  (provider download window passed)
--
-- The database decides everything: eligibility, deterministic storage paths, the target property (only through
-- media → message → submission session → the session's Phase 6 draft), ordering, limits and retries.
-- The n8n worker only moves bytes (Meta → private bucket → public bucket) and reports facts, which are re-checked
-- here against storage.objects and storage.buckets. A media item is 'attached' only when BOTH the Storage object
-- exists and the property_images row exists. Nothing here publishes, approves or changes a property.
--
-- Buckets are unchanged: whatsapp-media (private) holds the originals at {agency}/{yyyy}/{mm}/{media_id}.{ext};
-- property-images (existing public-object bucket, no list/write policies) holds validated copies at the existing
-- convention properties/{property_id}/{media_id}.{ext}. Draft images are reachable by no public query or route.
-- Rollback: docs/rebuild/phase-07-media-storage.md, section "Rollback".
-- =============================================================================

-- ------------------------------------------------------------------ configuration
create function public.media_pipeline_config()
returns jsonb
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select jsonb_build_object(
    'download_window_seconds', 7 * 24 * 3600,   -- Meta: inbound media retrievable for a limited time after receipt
    'lease_seconds',           300,
    'max_download_attempts',   6,
    'max_validation_attempts', 4,
    'max_attach_attempts',     6,
    'backoff_base_seconds',    60,
    'backoff_max_seconds',     3600,
    'max_dimension',           20000,
    'max_pixels',              100000000,
    'batch_limit',             10);
$$;
comment on function public.media_pipeline_config() is
  'Phase 7 media pipeline constants. Size limit and allowed image formats are NOT here: they are read from '
  'storage.buckets (property-images), the single source of truth.';

create function public.media_file_extension(p_mime text)
returns text
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select case lower(split_part(coalesce(p_mime, ''), ';', 1))
           when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp'
           when 'image/avif' then 'avif' when 'image/heic' then 'heic' when 'image/heif' then 'heif'
           when 'image/gif' then 'gif' else 'bin' end;
$$;

create function public.media_is_image(p_message_type text, p_mime text)
returns boolean
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select p_message_type = 'image'
      or (p_message_type = 'document' and lower(coalesce(p_mime, '')) like 'image/%');
$$;
comment on function public.media_is_image(text, text) is
  'Property photos: WhatsApp image messages, and documents that declare an image type (sent uncompressed). '
  'Stickers, video, audio and other documents are never downloaded.';

-- ------------------------------------------------------------------ whatsapp_media
alter table public.whatsapp_media
  add column download_deadline_at timestamptz,
  add column detected_mime_type   text,
  add column validated_at         timestamptz,
  add column attached_at          timestamptz,
  add column validation_attempts  smallint not null default 0,
  add column attach_attempts      smallint not null default 0,
  add column lease_attempt_id     uuid,
  add column lease_expires_at     timestamptz,
  add column lease_worker         text,
  add column next_attempt_at      timestamptz,
  add column target_property_id   uuid references public.properties (id) on delete set null,
  add column failed_stage         text,
  add column status_reason        text;

update public.whatsapp_media wm
   set download_deadline_at = coalesce(least(m.provider_timestamp, m.received_at), wm.created_at)
                              + make_interval(secs => (public.media_pipeline_config() ->> 'download_window_seconds')::int)
  from public.whatsapp_messages m
 where m.id = wm.message_id and wm.download_deadline_at is null;

alter table public.whatsapp_media alter column download_deadline_at set not null;

alter table public.whatsapp_media
  drop constraint whatsapp_media_download_status_check,
  drop constraint whatsapp_media_downloaded_consistency,
  drop constraint whatsapp_media_storage_path_format;

alter table public.whatsapp_media
  add constraint whatsapp_media_download_status_check
    check (download_status in ('received', 'downloading', 'downloaded', 'validating', 'validated', 'attaching',
                               'uploaded', 'attached', 'rejected', 'failed', 'expired', 'skipped')),
  add constraint whatsapp_media_storage_path_format
    check (storage_path is null
           or storage_path ~ ('^' || agency_id::text || '/[0-9]{4}/[0-9]{2}/' || id::text || '\.[a-z0-9]{2,5}$')),
  add constraint whatsapp_media_stored_consistency
    check (download_status not in ('downloaded', 'validating', 'validated', 'attaching', 'uploaded', 'attached')
           or (storage_path is not null and downloaded_at is not null and file_size is not null)),
  add constraint whatsapp_media_validated_consistency
    check (download_status not in ('validated', 'attaching', 'uploaded', 'attached')
           or (detected_mime_type is not null and sha256 is not null and width is not null and height is not null
               and validated_at is not null)),
  add constraint whatsapp_media_attached_consistency
    check ((download_status = 'attached') = (attached_at is not null)),
  add constraint whatsapp_media_lease_consistency
    check ((download_status in ('downloading', 'validating', 'attaching'))
           = (lease_expires_at is not null and lease_attempt_id is not null)),
  add constraint whatsapp_media_target_consistency
    check (download_status not in ('attaching', 'uploaded', 'attached') or target_property_id is not null),
  add constraint whatsapp_media_failed_consistency
    check ((download_status = 'failed') = (failed_stage is not null)),
  add constraint whatsapp_media_failed_stage_check
    check (failed_stage in ('download', 'validation', 'attachment')),
  add constraint whatsapp_media_detected_mime_check
    check (detected_mime_type in ('image/jpeg', 'image/png', 'image/webp', 'image/avif')),
  add constraint whatsapp_media_attempts_check
    check (validation_attempts >= 0 and attach_attempts >= 0),
  add constraint whatsapp_media_status_reason_check
    check (status_reason ~ '^[a-z][a-z0-9_:]{0,79}$'),
  add constraint whatsapp_media_lease_worker_check
    check (char_length(lease_worker) <= 200);

drop index public.whatsapp_media_pending_idx;
create index whatsapp_media_due_idx on public.whatsapp_media (download_status, next_attempt_at)
  where download_status in ('received', 'downloaded', 'validated', 'uploaded');
create index whatsapp_media_lease_idx on public.whatsapp_media (lease_expires_at) where lease_expires_at is not null;
create index whatsapp_media_target_property_idx on public.whatsapp_media (target_property_id)
  where target_property_id is not null;

comment on column public.whatsapp_media.download_status is
  'Media state: received → downloading → downloaded → validating → validated → attaching → uploaded → attached; '
  'terminal/reviewable: rejected (invalid binary), failed (retries exhausted), expired (download window passed), '
  'skipped (never eligible). Only ''attached'' means Storage object AND property_images row exist.';
comment on column public.whatsapp_media.storage_path is
  'Original in the PRIVATE whatsapp-media bucket: {agency_id}/{yyyy}/{mm}/{media_id}.{ext}. Deterministic, set by the database.';
comment on column public.whatsapp_media.mime_type is 'MIME type declared by the provider (informational, never trusted).';
comment on column public.whatsapp_media.detected_mime_type is 'Image format detected from the bytes during validation.';
comment on column public.whatsapp_media.sha256 is 'SHA-256 of the stored original (hex).';
comment on column public.whatsapp_media.download_deadline_at is
  'Last moment the provider still serves the media: earliest of provider timestamp / receipt + download window.';
comment on column public.whatsapp_media.target_property_id is
  'Draft the media is being attached to; always derived by the database from message → session → property.';
comment on column public.whatsapp_media.status_reason is
  'Machine code for the current state: rejection code, skip reason, failure code, expiry, or held:<reason>.';

-- deadline on insert (ingestion is unchanged; the trigger derives it from the message)
create function public.whatsapp_media_set_deadline()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_at timestamptz;
begin
  select coalesce(least(m.provider_timestamp, m.received_at), now()) into v_at
    from whatsapp_messages m where m.id = new.message_id;
  new.download_deadline_at := coalesce(v_at, now())
    + make_interval(secs => (media_pipeline_config() ->> 'download_window_seconds')::int);
  return new;
end;
$$;
revoke execute on function public.whatsapp_media_set_deadline() from public, anon, authenticated;

create trigger whatsapp_media_set_deadline_trg
  before insert on public.whatsapp_media
  for each row execute function public.whatsapp_media_set_deadline();

-- ------------------------------------------------------------------ trusted association
create function public.media_property_association(p_media_id uuid)
returns jsonb
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_media   whatsapp_media%rowtype;
  v_msg     whatsapp_messages%rowtype;
  v_session submission_sessions%rowtype;
  v_agent   agents%rowtype;
  v_prop    properties%rowtype;
  v_order   integer;
  v_reason  text;
begin
  select * into v_media from whatsapp_media where id = p_media_id;
  if v_media.id is null then
    return jsonb_build_object('eligible', false, 'reason', 'media_missing');
  end if;
  select * into v_msg from whatsapp_messages where id = v_media.message_id;
  if v_msg.session_id is not null then
    select * into v_session from submission_sessions where id = v_msg.session_id;
  end if;
  if v_session.agent_id is not null then
    select * into v_agent from agents where id = v_session.agent_id;
  end if;
  if v_session.id is not null then
    select * into v_prop from properties where created_from_session_id = v_session.id;
  end if;

  v_reason := case
    when v_msg.id is null or v_msg.agency_id <> v_media.agency_id                 then 'message_mismatch'
    when not media_is_image(v_msg.message_type, v_media.mime_type)                 then 'not_an_image'
    when v_msg.conversation_type <> 'direct'                                       then 'group_conversation'
    when v_msg.agent_id is null                                                    then 'sender_unresolved'
    when v_session.id is null                                                      then 'no_session'
    when v_session.agency_id <> v_media.agency_id or v_session.agent_id <> v_msg.agent_id
                                                                                   then 'session_mismatch'
    when v_agent.id is null or not v_agent.is_active                               then 'agent_inactive'
    when v_agent.agency_id <> v_session.agency_id                                  then 'agency_mismatch'
    when v_session.status = 'cancelled'                                            then 'session_cancelled'
    when v_prop.id is null and v_session.status in ('open', 'ready', 'processing') then 'session_pending'
    when v_prop.id is null                                                         then 'no_property'
    when v_prop.agency_id is distinct from v_session.agency_id
      or v_prop.agent_id is distinct from v_session.agent_id
      or v_prop.source <> 'whatsapp'                                               then 'property_mismatch'
    when v_prop.listing_status <> 'draft'                                          then 'property_not_draft'
    when not exists (select 1 from extraction_results er
                      where er.session_id = v_session.id and er.property_id = v_prop.id
                        and er.status = 'succeeded' and er.validation_status = 'valid')
                                                                                   then 'extraction_not_valid'
  end;
  if v_reason is not null then
    return jsonb_strip_nulls(jsonb_build_object('eligible', false, 'reason', v_reason,
             'session_id', v_session.id, 'property_id', v_prop.id));
  end if;

  -- Deterministic gallery position: rank of this media among the session's photos by WhatsApp timestamp, then
  -- provider message id, then media id. Independent of processing order, retries and AI output.
  select count(*) into v_order
    from whatsapp_media m2
    join whatsapp_messages x on x.id = m2.message_id
   where x.session_id = v_session.id
     and media_is_image(x.message_type, m2.mime_type)
     and (coalesce(x.provider_timestamp, x.received_at), x.provider_message_id, m2.id)
       < (coalesce(v_msg.provider_timestamp, v_msg.received_at), v_msg.provider_message_id, v_media.id);

  return jsonb_build_object('eligible', true, 'agency_id', v_session.agency_id, 'agent_id', v_session.agent_id,
                            'session_id', v_session.id, 'message_id', v_msg.id, 'property_id', v_prop.id,
                            'sort_order', v_order);
end;
$$;
comment on function public.media_property_association(uuid) is
  'The ONLY way a media item is associated with a property: media → message → submission session (same agency, '
  'same agent, agent active) → the draft created from that session with a valid extraction. No other input.';

-- ------------------------------------------------------------------ property_images guard
create unique index property_images_media_key on public.property_images (media_id) where media_id is not null;

create function public.property_images_provenance_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_prop_agency uuid;
  v_media       whatsapp_media%rowtype;
  v_assoc       jsonb;
begin
  if tg_op = 'UPDATE' and (new.property_id, new.agency_id, new.media_id, new.storage_path)
                          is distinct from (old.property_id, old.agency_id, old.media_id, old.storage_path) then
    raise exception 'property_images provenance (property, agency, media, storage path) is immutable'
      using errcode = 'check_violation';
  end if;

  select agency_id into v_prop_agency from properties where id = new.property_id;
  if v_prop_agency is null or v_prop_agency <> new.agency_id then
    raise exception 'property image agency must equal the property agency' using errcode = 'check_violation';
  end if;

  if tg_op = 'INSERT' and new.media_id is not null then
    select * into v_media from whatsapp_media where id = new.media_id;
    v_assoc := media_property_association(new.media_id);
    if not coalesce((v_assoc ->> 'eligible')::boolean, false)
       or (v_assoc ->> 'property_id')::uuid is distinct from new.property_id
       or v_media.agency_id <> new.agency_id
       or v_media.detected_mime_type is null or v_media.validated_at is null
       or new.storage_path <> 'properties/' || new.property_id || '/' || new.media_id || '.'
                              || media_file_extension(v_media.detected_mime_type) then
      raise exception 'media % cannot be attached to property % (%)', new.media_id, new.property_id,
        coalesce(v_assoc ->> 'reason', 'provenance_mismatch') using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.property_images_provenance_guard() from public, anon, authenticated;

create trigger property_images_provenance_guard_trg
  before insert or update on public.property_images
  for each row execute function public.property_images_provenance_guard();

-- ------------------------------------------------------------------ internal helpers
create function public.media_event(p_media whatsapp_media, p_type text, p_severity text, p_correlation text,
                                   p_details jsonb default '{}'::jsonb, p_property_id uuid default null)
returns void
language sql
set search_path = public, pg_temp
as $$
  insert into automation_events (agency_id, event_type, severity, source, session_id, message_id, property_id,
                                 correlation_id, details)
  select p_media.agency_id, p_type, p_severity, 'n8n', m.session_id, m.id,
         coalesce(p_property_id, p_media.target_property_id), left(p_correlation, 200),
         jsonb_strip_nulls(jsonb_build_object('media_id', p_media.id, 'status', p_media.download_status,
                                              'reason', p_media.status_reason) || coalesce(p_details, '{}'::jsonb))
    from whatsapp_messages m where m.id = p_media.message_id;
$$;

create function public.media_storage_object_size(p_bucket text, p_name text)
returns bigint
language sql
stable
set search_path = pg_catalog, pg_temp
as $$
  select (o.metadata ->> 'size')::bigint from storage.objects o where o.bucket_id = p_bucket and o.name = p_name;
$$;
comment on function public.media_storage_object_size(text, text) is
  'Size of an object as recorded by the Storage API (null if the object does not exist).';

create function public.media_target_path(p_property_id uuid, p_media_id uuid, p_mime text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select 'properties/' || p_property_id || '/' || p_media_id || '.' || media_file_extension(p_mime);
$$;

-- Failure of the currently leased stage. Caller holds the row lock and has verified the attempt.
create function public.media_stage_failure(p_media_id uuid, p_code text, p_message text, p_permanent boolean,
                                           p_correlation text)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  c_reject  constant text[] := array['empty_file', 'oversized', 'unsupported_format', 'corrupt_image',
                                     'dimensions_out_of_range', 'mime_not_allowed', 'hash_mismatch', 'size_mismatch'];
  v         whatsapp_media%rowtype;
  v_cfg     jsonb := media_pipeline_config();
  v_code    text := case when p_code ~ '^[a-z][a-z0-9_]{0,59}$' then p_code else 'unknown_error' end;
  v_stage   text;
  v_prev    text;
  v_tries   integer;
  v_max     integer;
  v_next    text;
  v_delay   integer;
begin
  select * into v from whatsapp_media where id = p_media_id for update;
  v_stage := case v.download_status when 'downloading' then 'download' when 'validating' then 'validation'
                                    when 'attaching' then 'attachment' end;
  if v_stage is null then
    return jsonb_build_object('ok', false, 'outcome', 'not_leased');
  end if;
  v_prev  := case v_stage when 'download' then 'received' when 'validation' then 'downloaded' else 'validated' end;
  v_tries := case v_stage when 'download' then v.download_attempts when 'validation' then v.validation_attempts
                          else v.attach_attempts end;
  v_max   := (v_cfg ->> case v_stage when 'download' then 'max_download_attempts'
                                     when 'validation' then 'max_validation_attempts' else 'max_attach_attempts' end)::int;

  v_next := case
    when v_code = any (c_reject) and v_stage in ('download', 'validation') then 'rejected'
    when v_stage = 'download' and v.download_deadline_at <= now()            then 'expired'
    when p_permanent or v_tries >= v_max                                       then 'failed'
    else v_prev
  end;
  v_delay := least((v_cfg ->> 'backoff_max_seconds')::int,
                   (v_cfg ->> 'backoff_base_seconds')::int * (2 ^ greatest(v_tries - 1, 0))::int);

  update whatsapp_media
     set download_status  = v_next,
         lease_expires_at = null,
         lease_worker     = null,
         next_attempt_at  = case when v_next = v_prev then now() + make_interval(secs => v_delay) end,
         failed_stage     = case when v_next = 'failed' then v_stage end,
         target_property_id = case when v_next in ('failed', 'rejected', 'expired', 'validated') and v_stage = 'attachment'
                                   then null else target_property_id end,
         status_reason    = case when v_next = 'expired' then 'download_window_passed'
                                 when v_next = v_prev then 'retry_scheduled' else v_code end,
         last_error       = v_code || ': ' || redact_error_text(p_message)
   where id = p_media_id
  returning * into v;

  perform media_event(v, case v_next when 'rejected' then 'media.rejected' when 'expired' then 'media.expired'
                                     when 'failed' then 'media.failed' else 'media.retry_scheduled' end,
                      case when v_next = v_prev then 'info' else 'warning' end, p_correlation,
                      jsonb_build_object('stage', v_stage, 'code', v_code, 'attempts', v_tries,
                                         'retry_in_seconds', case when v_next = v_prev then v_delay end));
  return jsonb_build_object('ok', true, 'outcome', v_next, 'stage', v_stage, 'code', v_code);
end;
$$;

-- Insert the property_images row for an 'uploaded' media item (caller holds the row lock).
create function public.media_record_image(p_media_id uuid, p_correlation text)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v       whatsapp_media%rowtype;
  v_assoc jsonb;
  v_image uuid;
  v_path  text;
begin
  select * into v from whatsapp_media where id = p_media_id for update;
  if v.download_status <> 'uploaded' then
    return jsonb_build_object('ok', false, 'outcome', 'not_uploaded');
  end if;

  v_assoc := media_property_association(v.id);
  if not (v_assoc ->> 'eligible')::boolean or (v_assoc ->> 'property_id')::uuid is distinct from v.target_property_id then
    update whatsapp_media set status_reason = 'held:' || coalesce(v_assoc ->> 'reason', 'property_changed')
     where id = v.id and status_reason is distinct from 'held:' || coalesce(v_assoc ->> 'reason', 'property_changed')
    returning * into v;
    if found then
      perform media_event(v, 'media.attachment_held', 'warning', p_correlation, jsonb_build_object('stage', 'record'));
    end if;
    return jsonb_build_object('ok', true, 'outcome', 'held', 'reason', coalesce(v_assoc ->> 'reason', 'property_changed'));
  end if;

  v_path := media_target_path(v.target_property_id, v.id, v.detected_mime_type);
  begin
    set constraints public.property_images_sort_order_key immediate;
    insert into property_images (agency_id, property_id, media_id, storage_path, sort_order, width, height)
    values (v.agency_id, v.target_property_id, v.id, v_path, (v_assoc ->> 'sort_order')::int, v.width, v.height)
    on conflict (media_id) where media_id is not null do nothing
    returning id into v_image;
    if v_image is null then
      select id into v_image from property_images
       where media_id = v.id and property_id = v.target_property_id and storage_path = v_path;
      if v_image is null then
        raise exception 'media % already attached elsewhere', v.id using errcode = 'unique_violation';
      end if;
    end if;
  exception when others then
    update whatsapp_media
       set status_reason = 'image_record_failed',
           last_error = 'image_record_failed: ' || sqlstate || ' ' || redact_error_text(sqlerrm)
     where id = v.id
    returning * into v;
    perform media_event(v, 'media.image_record_failed', 'error', p_correlation, jsonb_build_object('sqlstate', sqlstate));
    return jsonb_build_object('ok', false, 'outcome', 'uploaded_pending_record', 'sqlstate', sqlstate);
  end;

  update whatsapp_media
     set download_status = 'attached', attached_at = now(), status_reason = null, last_error = null
   where id = v.id
  returning * into v;
  perform media_event(v, 'media.attached', 'info', p_correlation,
                      jsonb_build_object('property_image_id', v_image, 'sort_order', (v_assoc ->> 'sort_order')::int,
                                         'storage_path', v_path));
  return jsonb_build_object('ok', true, 'outcome', 'attached', 'property_image_id', v_image,
                            'property_id', v.target_property_id, 'storage_path', v_path,
                            'sort_order', (v_assoc ->> 'sort_order')::int);
end;
$$;

-- ------------------------------------------------------------------ stage 1: download (Meta → private bucket)
create function public.claim_media_downloads(p_worker text default null, p_limit integer default null)
returns setof jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_cfg    jsonb := media_pipeline_config();
  v_limit  integer := least(greatest(coalesce(p_limit, (v_cfg ->> 'batch_limit')::int), 1), 50);
  v_worker text := left(nullif(btrim(p_worker), ''), 200);
  v_max    bigint;
  v_row    whatsapp_media%rowtype;
begin
  select file_size_limit into v_max from storage.buckets where id = 'property-images';
  for v_row in
    select wm.* from whatsapp_media wm
      join whatsapp_messages m on m.id = wm.message_id
     where wm.download_status = 'received'
       and coalesce(wm.next_attempt_at, '-infinity') <= now()
       and wm.download_deadline_at > now()
       and m.agent_id is not null and m.conversation_type = 'direct' and m.processing_status <> 'ignored'
       and media_is_image(m.message_type, wm.mime_type)
     order by wm.download_deadline_at, wm.created_at, wm.id
     limit v_limit
     for update of wm skip locked
  loop
    update whatsapp_media
       set download_status   = 'downloading',
           download_attempts = download_attempts + 1,
           lease_attempt_id  = gen_random_uuid(),
           lease_expires_at  = now() + make_interval(secs => (v_cfg ->> 'lease_seconds')::int),
           lease_worker      = v_worker,
           next_attempt_at   = null,
           status_reason     = null,
           storage_path      = coalesce(storage_path, agency_id || '/' || to_char(created_at at time zone 'UTC', 'YYYY/MM')
                                                      || '/' || id || '.' || media_file_extension(mime_type))
     where id = v_row.id
    returning * into v_row;
    return next jsonb_build_object(
      'media_id', v_row.id, 'attempt_id', v_row.lease_attempt_id, 'attempt_number', v_row.download_attempts,
      'provider', v_row.provider, 'provider_media_id', v_row.provider_media_id,
      'provider_mime_type', v_row.mime_type, 'storage_bucket', 'whatsapp-media', 'storage_path', v_row.storage_path,
      'max_bytes', v_max, 'download_deadline_at', v_row.download_deadline_at);
  end loop;
end;
$$;
comment on function public.claim_media_downloads(text, integer) is
  'Leases due media for download (FOR UPDATE SKIP LOCKED). Only photos of resolved agents in direct conversations, '
  'inside the provider download window. Returns the provider media id and the deterministic private storage path.';

create function public.complete_media_download(p_media_id uuid, p_attempt_id uuid, p_file_size bigint,
                                               p_sha256 text, p_correlation_id text default null)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v      whatsapp_media%rowtype;
  v_size bigint;
begin
  select * into v from whatsapp_media where id = p_media_id for update;
  if v.id is null then
    return jsonb_build_object('ok', false, 'outcome', 'not_found');
  end if;
  if v.download_status <> 'downloading' or v.lease_attempt_id is distinct from p_attempt_id then
    return jsonb_build_object('ok', coalesce(v.lease_attempt_id = p_attempt_id, false), 'outcome',
                              case when v.lease_attempt_id = p_attempt_id then 'duplicate' else 'stale_attempt' end,
                              'status', v.download_status);
  end if;
  if p_file_size is null or p_file_size <= 0 then
    return media_stage_failure(v.id, 'empty_file', 'reported size ' || coalesce(p_file_size::text, 'null'), true, p_correlation_id);
  end if;
  if p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then
    return media_stage_failure(v.id, 'invalid_report', 'sha256 missing or malformed', false, p_correlation_id);
  end if;

  v_size := media_storage_object_size('whatsapp-media', v.storage_path);
  if v_size is null then
    return media_stage_failure(v.id, 'object_missing', 'original not found in whatsapp-media', false, p_correlation_id);
  end if;
  if v_size <> p_file_size then
    -- Never overwritten: an existing object with other content at the deterministic path needs review.
    return media_stage_failure(v.id, 'storage_object_conflict',
                               'stored size ' || v_size || ' <> downloaded size ' || p_file_size, true, p_correlation_id);
  end if;

  update whatsapp_media
     set download_status = 'downloaded', downloaded_at = now(), file_size = p_file_size, sha256 = p_sha256,
         lease_expires_at = null, lease_worker = null, status_reason = null, last_error = null
   where id = v.id
  returning * into v;
  perform media_event(v, 'media.downloaded', 'info', p_correlation_id,
                      jsonb_build_object('file_size', p_file_size, 'storage_path', v.storage_path));
  return jsonb_build_object('ok', true, 'outcome', 'downloaded', 'media_id', v.id);
end;
$$;

-- ------------------------------------------------------------------ stage 2: validation (private original)
create function public.claim_media_validations(p_worker text default null, p_limit integer default null,
                                               p_media_id uuid default null)
returns setof jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_cfg     jsonb := media_pipeline_config();
  v_limit   integer := least(greatest(coalesce(p_limit, (v_cfg ->> 'batch_limit')::int), 1), 50);
  v_worker  text := left(nullif(btrim(p_worker), ''), 200);
  v_bucket  storage.buckets%rowtype;
  v_row     whatsapp_media%rowtype;
begin
  select * into v_bucket from storage.buckets where id = 'property-images';
  for v_row in
    select * from whatsapp_media
     where download_status = 'downloaded'
       and coalesce(next_attempt_at, '-infinity') <= now()
       and (p_media_id is null or id = p_media_id)
     order by downloaded_at, id
     limit v_limit
     for update skip locked
  loop
    update whatsapp_media
       set download_status     = 'validating',
           validation_attempts = validation_attempts + 1,
           lease_attempt_id    = gen_random_uuid(),
           lease_expires_at    = now() + make_interval(secs => (v_cfg ->> 'lease_seconds')::int),
           lease_worker        = v_worker,
           next_attempt_at     = null,
           status_reason       = null
     where id = v_row.id
    returning * into v_row;
    return next jsonb_build_object(
      'media_id', v_row.id, 'attempt_id', v_row.lease_attempt_id, 'attempt_number', v_row.validation_attempts,
      'storage_bucket', 'whatsapp-media', 'storage_path', v_row.storage_path,
      'expected_file_size', v_row.file_size, 'expected_sha256', v_row.sha256,
      'limits', jsonb_build_object('allowedMimeTypes', to_jsonb(v_bucket.allowed_mime_types),
                                   'maxBytes', v_bucket.file_size_limit,
                                   'maxDimension', (v_cfg ->> 'max_dimension')::int,
                                   'maxPixels', (v_cfg ->> 'max_pixels')::bigint));
  end loop;
end;
$$;

create function public.record_media_validation(p_media_id uuid, p_attempt_id uuid, p_result jsonb,
                                               p_correlation_id text default null)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v        whatsapp_media%rowtype;
  v_cfg    jsonb := media_pipeline_config();
  v_bucket storage.buckets%rowtype;
  v_size   bigint;
  v_sha    text;
  v_mime   text;
  v_w      bigint;
  v_h      bigint;
  v_code   text;
begin
  select * into v from whatsapp_media where id = p_media_id for update;
  if v.id is null then
    return jsonb_build_object('ok', false, 'outcome', 'not_found');
  end if;
  if v.download_status <> 'validating' or v.lease_attempt_id is distinct from p_attempt_id then
    return jsonb_build_object('ok', coalesce(v.lease_attempt_id = p_attempt_id, false), 'outcome',
                              case when v.lease_attempt_id = p_attempt_id then 'duplicate' else 'stale_attempt' end,
                              'status', v.download_status);
  end if;
  if p_result is null or jsonb_typeof(p_result) <> 'object' or jsonb_typeof(p_result -> 'valid') <> 'boolean'
     or (not (p_result ->> 'valid')::boolean
         and coalesce(p_result ->> 'code', '') not in ('empty_file', 'oversized', 'unsupported_format', 'corrupt_image',
                                                       'dimensions_out_of_range', 'mime_not_allowed')) then
    -- malformed report or a worker-side problem (e.g. limits unknown): transient, bounded retry
    return media_stage_failure(v.id, 'invalid_report', coalesce(p_result ->> 'code', 'validation result malformed'),
                               false, p_correlation_id);
  end if;

  select * into v_bucket from storage.buckets where id = 'property-images';
  v_size := case when jsonb_typeof(p_result -> 'file_size') = 'number' then (p_result ->> 'file_size')::numeric::bigint end;
  v_sha  := p_result ->> 'sha256';
  v_mime := p_result ->> 'detected_mime_type';
  v_w    := case when jsonb_typeof(p_result -> 'width') = 'number' then (p_result ->> 'width')::numeric::bigint end;
  v_h    := case when jsonb_typeof(p_result -> 'height') = 'number' then (p_result ->> 'height')::numeric::bigint end;

  -- The worker's verdict is necessary but not sufficient: every fact is re-checked here.
  v_code := case
    when not (p_result ->> 'valid')::boolean                               then p_result ->> 'code'
    when v_size is null or v_size <= 0                                     then 'empty_file'
    when v_size <> v.file_size                                             then 'size_mismatch'
    when v_sha is null or v_sha !~ '^[0-9a-f]{64}$'                        then 'hash_mismatch'
    when v.sha256 is not null and v_sha <> v.sha256                        then 'hash_mismatch'
    when v_size > v_bucket.file_size_limit                                 then 'oversized'
    when v_mime is null or not (v_mime = any (v_bucket.allowed_mime_types)) then 'mime_not_allowed'
    when v_w is null or v_h is null or v_w < 1 or v_h < 1
      or v_w > (v_cfg ->> 'max_dimension')::int or v_h > (v_cfg ->> 'max_dimension')::int
      or v_w * v_h > (v_cfg ->> 'max_pixels')::bigint                      then 'dimensions_out_of_range'
  end;
  if v_code is not null then
    return media_stage_failure(v.id, v_code, coalesce(p_result ->> 'detail', 'validation failed'), true, p_correlation_id);
  end if;

  update whatsapp_media
     set download_status = 'validated', detected_mime_type = v_mime, sha256 = v_sha, width = v_w, height = v_h,
         validated_at = now(), lease_expires_at = null, lease_worker = null, status_reason = null, last_error = null
   where id = v.id
  returning * into v;
  perform media_event(v, 'media.validated', 'info', p_correlation_id,
                      jsonb_strip_nulls(jsonb_build_object('detected_mime_type', v_mime, 'width', v_w, 'height', v_h,
                        'declared_mime_mismatch', case when lower(split_part(coalesce(v.mime_type, ''), ';', 1)) <> v_mime
                                                       then true end)));
  return jsonb_build_object('ok', true, 'outcome', 'validated', 'media_id', v.id);
end;
$$;

-- ------------------------------------------------------------------ stage 3: attachment (public copy + image row)
create function public.claim_media_attachments(p_worker text default null, p_limit integer default null,
                                               p_correlation_id text default null)
returns setof jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_cfg    jsonb := media_pipeline_config();
  v_limit  integer := least(greatest(coalesce(p_limit, (v_cfg ->> 'batch_limit')::int), 1), 50);
  v_worker text := left(nullif(btrim(p_worker), ''), 200);
  v_row    whatsapp_media%rowtype;
  v_assoc  jsonb;
  v_n      integer := 0;
  v_reason text;
begin
  for v_row in
    select * from whatsapp_media
     where download_status = 'validated'
       and coalesce(next_attempt_at, '-infinity') <= now()
     order by validated_at, id
     for update skip locked
  loop
    exit when v_n >= v_limit;
    v_assoc := media_property_association(v_row.id);
    if not (v_assoc ->> 'eligible')::boolean then
      v_reason := 'held:' || (v_assoc ->> 'reason');
      if v_row.status_reason is distinct from v_reason then
        update whatsapp_media set status_reason = v_reason where id = v_row.id returning * into v_row;
        perform media_event(v_row, 'media.attachment_held', 'info', p_correlation_id);
      end if;
      continue;
    end if;
    update whatsapp_media
       set download_status    = 'attaching',
           attach_attempts    = attach_attempts + 1,
           target_property_id = (v_assoc ->> 'property_id')::uuid,
           lease_attempt_id   = gen_random_uuid(),
           lease_expires_at   = now() + make_interval(secs => (v_cfg ->> 'lease_seconds')::int),
           lease_worker       = v_worker,
           next_attempt_at    = null,
           status_reason      = null
     where id = v_row.id
    returning * into v_row;
    v_n := v_n + 1;
    return next jsonb_build_object(
      'media_id', v_row.id, 'attempt_id', v_row.lease_attempt_id, 'attempt_number', v_row.attach_attempts,
      'source_bucket', 'whatsapp-media', 'source_path', v_row.storage_path,
      'target_bucket', 'property-images',
      'target_path', media_target_path(v_row.target_property_id, v_row.id, v_row.detected_mime_type),
      'content_type', v_row.detected_mime_type, 'file_size', v_row.file_size, 'sha256', v_row.sha256);
  end loop;
end;
$$;
comment on function public.claim_media_attachments(text, integer, text) is
  'Leases validated media whose trusted association (message → session → draft) is eligible and returns the '
  'deterministic public target path. Ineligible media stay validated with status_reason held:<reason>.';

create function public.complete_media_attachment(p_media_id uuid, p_attempt_id uuid, p_correlation_id text default null)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v       whatsapp_media%rowtype;
  v_assoc jsonb;
  v_path  text;
  v_size  bigint;
  v_image uuid;
begin
  select * into v from whatsapp_media where id = p_media_id for update;
  if v.id is null then
    return jsonb_build_object('ok', false, 'outcome', 'not_found');
  end if;
  if v.download_status in ('uploaded', 'attached') and v.lease_attempt_id = p_attempt_id then
    select id into v_image from property_images where media_id = v.id;
    return jsonb_strip_nulls(jsonb_build_object('ok', true, 'outcome', 'duplicate', 'status', v.download_status,
                                                'property_image_id', v_image));
  end if;
  if v.download_status <> 'attaching' or v.lease_attempt_id is distinct from p_attempt_id then
    return jsonb_build_object('ok', false, 'outcome', 'stale_attempt', 'status', v.download_status);
  end if;

  v_assoc := media_property_association(v.id);
  if not (v_assoc ->> 'eligible')::boolean or (v_assoc ->> 'property_id')::uuid is distinct from v.target_property_id then
    update whatsapp_media
       set download_status = 'validated', lease_expires_at = null, lease_worker = null, target_property_id = null,
           status_reason = 'held:' || coalesce(v_assoc ->> 'reason', 'property_changed')
     where id = v.id
    returning * into v;
    perform media_event(v, 'media.attachment_held', 'warning', p_correlation_id, jsonb_build_object('stage', 'complete'));
    return jsonb_build_object('ok', true, 'outcome', 'held', 'reason', coalesce(v_assoc ->> 'reason', 'property_changed'));
  end if;

  v_path := media_target_path(v.target_property_id, v.id, v.detected_mime_type);
  v_size := media_storage_object_size('property-images', v_path);
  if v_size is null then
    return media_stage_failure(v.id, 'object_missing', 'image not found in property-images', false, p_correlation_id);
  end if;
  if v_size <> v.file_size then
    return media_stage_failure(v.id, 'storage_object_conflict',
                               'stored size ' || v_size || ' <> original size ' || v.file_size, true, p_correlation_id);
  end if;

  update whatsapp_media set download_status = 'uploaded', lease_expires_at = null, lease_worker = null,
                            status_reason = null
   where id = v.id;
  return media_record_image(v.id, p_correlation_id);
end;
$$;

-- ------------------------------------------------------------------ worker-reported failure (any leased stage)
create function public.record_media_failure(p_media_id uuid, p_attempt_id uuid, p_code text, p_message text default null,
                                            p_permanent boolean default false, p_correlation_id text default null)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v whatsapp_media%rowtype;
begin
  select * into v from whatsapp_media where id = p_media_id for update;
  if v.id is null then
    return jsonb_build_object('ok', false, 'outcome', 'not_found');
  end if;
  if v.download_status not in ('downloading', 'validating', 'attaching') or v.lease_attempt_id is distinct from p_attempt_id then
    return jsonb_build_object('ok', false, 'outcome', 'stale_attempt', 'status', v.download_status);
  end if;
  return media_stage_failure(v.id, p_code, p_message, coalesce(p_permanent, false), p_correlation_id);
end;
$$;

-- ------------------------------------------------------------------ recovery sweep
create function public.advance_media_pipeline(p_correlation_id text default null)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_row       whatsapp_media%rowtype;
  v_skipped   integer := 0;
  v_expired   integer := 0;
  v_leases    integer := 0;
  v_reconciled integer := 0;
  v_recorded  integer := 0;
  v_size      bigint;
  v_res       jsonb;
begin
  -- 1. never-eligible media: stored metadata is kept, nothing is downloaded
  for v_row in
    update whatsapp_media wm
       set download_status = 'skipped', next_attempt_at = null,
           status_reason = case when not media_is_image(m.message_type, wm.mime_type) then 'not_an_image'
                                when m.conversation_type <> 'direct' then 'group_conversation'
                                when m.agent_id is null then 'sender_unresolved'
                                else 'message_ignored' end
      from whatsapp_messages m
     where m.id = wm.message_id and wm.download_status = 'received'
       and (not media_is_image(m.message_type, wm.mime_type) or m.conversation_type <> 'direct'
            or m.agent_id is null or m.processing_status = 'ignored')
    returning wm.*
  loop
    v_skipped := v_skipped + 1;
    perform media_event(v_row, 'media.skipped', 'info', p_correlation_id);
  end loop;

  -- 2. provider download window passed before the original was secured
  for v_row in
    update whatsapp_media set download_status = 'expired', next_attempt_at = null, status_reason = 'download_window_passed'
     where download_status = 'received' and download_deadline_at <= now()
    returning *
  loop
    v_expired := v_expired + 1;
    perform media_event(v_row, 'media.expired', 'warning', p_correlation_id);
  end loop;

  -- 3. expired leases: reconcile objects that were stored but not confirmed, otherwise retry / fail / expire
  for v_row in
    select * from whatsapp_media
     where download_status in ('downloading', 'validating', 'attaching') and lease_expires_at <= now()
     order by lease_expires_at
     limit 200
     for update skip locked
  loop
    v_leases := v_leases + 1;
    if v_row.download_status = 'downloading' then
      v_size := media_storage_object_size('whatsapp-media', v_row.storage_path);
      if v_size > 0 then
        update whatsapp_media
           set download_status = 'downloaded', downloaded_at = now(), file_size = v_size,
               lease_expires_at = null, lease_worker = null, status_reason = 'reconciled'
         where id = v_row.id
        returning * into v_row;
        v_reconciled := v_reconciled + 1;
        perform media_event(v_row, 'media.reconciled', 'info', p_correlation_id, jsonb_build_object('stage', 'download'));
        continue;
      end if;
    elsif v_row.download_status = 'attaching' then
      v_size := media_storage_object_size('property-images',
                                          media_target_path(v_row.target_property_id, v_row.id, v_row.detected_mime_type));
      if v_size = v_row.file_size then
        update whatsapp_media set download_status = 'uploaded', lease_expires_at = null, lease_worker = null,
                                  status_reason = 'reconciled'
         where id = v_row.id
        returning * into v_row;
        v_reconciled := v_reconciled + 1;
        perform media_event(v_row, 'media.reconciled', 'info', p_correlation_id, jsonb_build_object('stage', 'attachment'));
        continue;
      end if;
    end if;
    perform media_stage_failure(v_row.id, 'lease_expired', 'worker did not report before the lease ended', false,
                                p_correlation_id);
  end loop;

  -- 4. uploaded but no image row yet (e.g. database failure after the upload)
  for v_row in
    select * from whatsapp_media where download_status = 'uploaded' order by updated_at limit 100 for update skip locked
  loop
    v_res := media_record_image(v_row.id, p_correlation_id);
    if v_res ->> 'outcome' = 'attached' then
      v_recorded := v_recorded + 1;
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'skipped', v_skipped, 'expired', v_expired, 'expired_leases', v_leases,
                            'reconciled', v_reconciled, 'images_recorded', v_recorded);
end;
$$;
comment on function public.advance_media_pipeline(text) is
  'Idempotent recovery sweep: skips never-eligible media, expires media past the provider window, reconciles '
  'objects stored without confirmation, retries/fails expired leases (bounded attempts), records missing image rows.';

-- ------------------------------------------------------------------ manual requeue (review)
create function public.request_media_reprocessing(p_media_id uuid, p_reason text default null)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v      whatsapp_media%rowtype;
  v_next text;
begin
  select * into v from whatsapp_media where id = p_media_id for update;
  if v.id is null then
    return jsonb_build_object('ok', false, 'outcome', 'not_found');
  end if;
  if v.download_status <> 'failed' then
    return jsonb_build_object('ok', false, 'outcome', 'not_requeueable', 'status', v.download_status);
  end if;
  v_next := case v.failed_stage when 'download' then 'received' when 'validation' then 'downloaded' else 'validated' end;
  if v_next = 'received' and v.download_deadline_at <= now() then
    update whatsapp_media set download_status = 'expired', failed_stage = null, status_reason = 'download_window_passed'
     where id = v.id returning * into v;
    perform media_event(v, 'media.expired', 'warning', null);
    return jsonb_build_object('ok', false, 'outcome', 'expired');
  end if;
  update whatsapp_media
     set download_status = v_next, failed_stage = null, next_attempt_at = now(), status_reason = 'requeued',
         download_attempts   = case when v_next = 'received' then 0 else download_attempts end,
         validation_attempts = case when v_next = 'downloaded' then 0 else validation_attempts end,
         attach_attempts     = case when v_next = 'validated' then 0 else attach_attempts end,
         target_property_id  = case when v_next = 'validated' then null else target_property_id end
   where id = v.id
  returning * into v;
  perform media_event(v, 'media.requeued', 'info', null,
                      jsonb_strip_nulls(jsonb_build_object('note', left(p_reason, 200))));
  return jsonb_build_object('ok', true, 'outcome', 'requeued', 'status', v_next);
end;
$$;

-- ------------------------------------------------------------------ privileges: service role only
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.media_pipeline_config()', 'public.media_file_extension(text)', 'public.media_is_image(text, text)',
    'public.media_property_association(uuid)', 'public.media_event(public.whatsapp_media, text, text, text, jsonb, uuid)',
    'public.media_storage_object_size(text, text)', 'public.media_target_path(uuid, uuid, text)',
    'public.media_stage_failure(uuid, text, text, boolean, text)', 'public.media_record_image(uuid, text)',
    'public.claim_media_downloads(text, integer)', 'public.complete_media_download(uuid, uuid, bigint, text, text)',
    'public.claim_media_validations(text, integer, uuid)', 'public.record_media_validation(uuid, uuid, jsonb, text)',
    'public.claim_media_attachments(text, integer, text)', 'public.complete_media_attachment(uuid, uuid, text)',
    'public.record_media_failure(uuid, uuid, text, text, boolean, text)', 'public.advance_media_pipeline(text)',
    'public.request_media_reprocessing(uuid, text)']
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;

comment on table public.property_images is
  'Ordered images of a property. Files live in the property-images bucket at properties/{property_id}/{file}. '
  'Readable by the public only for published properties (RLS); WhatsApp images carry media_id provenance, are '
  'inserted only by the media pipeline through the trusted association, and their provenance is immutable.';
