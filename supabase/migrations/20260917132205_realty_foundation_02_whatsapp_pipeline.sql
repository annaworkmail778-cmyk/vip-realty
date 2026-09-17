-- =============================================================================
-- Realty foundation 2/5 — WhatsApp submission pipeline state
--
--   submission_sessions  one property submission assembled from many messages
--   whatsapp_messages    every inbound provider message, stored exactly once
--   whatsapp_media       media attached to inbound messages and its download state
--   extraction_results   append-only history of AI extraction attempts
--
-- Grouping messages into sessions is deterministic application/n8n logic; these
-- tables hold the durable state and the idempotency guarantees for it.
-- Historical WhatsApp data is never cascade-deleted.
-- All tables are private: RLS enabled, no anon/authenticated privileges.
-- =============================================================================

-- ------------------------------------------------------- submission_sessions
create table public.submission_sessions (
  id                       uuid primary key default gen_random_uuid(),
  agency_id                uuid not null references public.agencies (id) on delete restrict,
  agent_id                 uuid not null references public.agents (id) on delete restrict,
  channel                  text not null default 'whatsapp',
  channel_conversation_key text not null,
  kind                     text not null default 'unknown',
  status                   text not null default 'open',
  close_reason             text,
  started_at               timestamptz not null default now(),
  last_message_at          timestamptz not null default now(),
  process_after            timestamptz,
  closed_at                timestamptz,
  property_id              uuid references public.properties (id) on delete set null,
  last_error               text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint submission_sessions_channel_check check (channel in ('whatsapp')),
  constraint submission_sessions_conversation_key_check
    check (btrim(channel_conversation_key) <> '' and char_length(channel_conversation_key) <= 200),
  constraint submission_sessions_kind_check
    check (kind in ('unknown', 'create', 'update', 'status_change')),
  constraint submission_sessions_status_check
    check (status in ('open', 'ready', 'processing', 'needs_review', 'completed', 'cancelled', 'failed')),
  constraint submission_sessions_close_reason_check
    check (close_reason in ('quiet_period', 'done_command', 'new_command', 'max_duration',
                            'cancel_command', 'admin', 'no_action')),
  constraint submission_sessions_closed_consistency
    check ((status in ('completed', 'cancelled', 'failed')) = (closed_at is not null)),
  constraint submission_sessions_time_order
    check (last_message_at >= started_at and (closed_at is null or closed_at >= started_at))
);

comment on table public.submission_sessions is
  'Groups the WhatsApp messages of one property submission. Deterministic grouping; at most one open session per conversation.';
comment on column public.submission_sessions.channel_conversation_key is
  'Stable conversation identifier within the channel. WhatsApp: the sender E.164 phone number.';
comment on column public.submission_sessions.process_after is
  'Debounce deadline: the session becomes ready once no new message arrives before this time.';

-- Idempotency: two concurrent webhooks cannot open two sessions for one conversation.
create unique index submission_sessions_one_open_per_conversation
  on public.submission_sessions (agency_id, channel, channel_conversation_key) where status = 'open';
create index submission_sessions_agency_started_idx
  on public.submission_sessions (agency_id, started_at desc);
create index submission_sessions_agent_last_message_idx
  on public.submission_sessions (agent_id, last_message_at desc);
create index submission_sessions_due_idx
  on public.submission_sessions (status, process_after) where status in ('open', 'ready', 'processing');
create index submission_sessions_property_idx
  on public.submission_sessions (property_id) where property_id is not null;

create trigger submission_sessions_touch_trg before update on public.submission_sessions
  for each row execute function public.touch_updated_at();

alter table public.submission_sessions enable row level security;
revoke all on table public.submission_sessions from anon, authenticated;

-- ---------------------------------------------------------- whatsapp_messages
create table public.whatsapp_messages (
  id                          uuid primary key default gen_random_uuid(),
  agency_id                   uuid not null references public.agencies (id) on delete restrict,
  agent_id                    uuid references public.agents (id) on delete restrict,
  session_id                  uuid references public.submission_sessions (id) on delete restrict,
  provider                    text not null default 'whatsapp_cloud',
  provider_message_id         text not null,
  sender_phone                text not null,
  message_type                text not null,
  body                        text,
  provider_timestamp          timestamptz,
  received_at                 timestamptz not null default now(),
  context_provider_message_id text,
  raw_payload                 jsonb not null,
  processing_status           text not null default 'received',
  processing_error            text,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  constraint whatsapp_messages_provider_message_key unique (provider, provider_message_id),
  constraint whatsapp_messages_provider_check check (provider in ('whatsapp_cloud')),
  constraint whatsapp_messages_provider_message_id_check
    check (btrim(provider_message_id) <> '' and char_length(provider_message_id) <= 255),
  constraint whatsapp_messages_sender_phone_e164 check (sender_phone ~ '^\+[1-9][0-9]{6,14}$'),
  constraint whatsapp_messages_message_type_check
    check (message_type in ('text', 'image', 'document', 'video', 'audio', 'sticker', 'location', 'contacts',
                            'interactive', 'button', 'reaction', 'order', 'system', 'unsupported')),
  constraint whatsapp_messages_body_check check (body is null or char_length(body) <= 65536),
  constraint whatsapp_messages_raw_payload_object check (jsonb_typeof(raw_payload) = 'object'),
  constraint whatsapp_messages_processing_status_check
    check (processing_status in ('received', 'buffered', 'processing', 'processed', 'failed', 'ignored')),
  constraint whatsapp_messages_session_required
    check (processing_status not in ('buffered', 'processing') or session_id is not null)
);

comment on table public.whatsapp_messages is
  'Every inbound WhatsApp message exactly once (unique provider + provider_message_id). Raw payload kept for troubleshooting.';
comment on column public.whatsapp_messages.provider_timestamp is
  'Timestamp reported by the provider. Order messages by (provider_timestamp, received_at), never by arrival.';
comment on column public.whatsapp_messages.context_provider_message_id is
  'Provider id of the message this one replies to (WhatsApp context.id).';

create index whatsapp_messages_agency_received_idx
  on public.whatsapp_messages (agency_id, received_at desc);
create index whatsapp_messages_agent_received_idx
  on public.whatsapp_messages (agent_id, received_at desc) where agent_id is not null;
create index whatsapp_messages_session_idx
  on public.whatsapp_messages (session_id, received_at) where session_id is not null;
create index whatsapp_messages_pending_idx
  on public.whatsapp_messages (processing_status, received_at)
  where processing_status in ('received', 'buffered', 'failed');
create index whatsapp_messages_context_idx
  on public.whatsapp_messages (context_provider_message_id) where context_provider_message_id is not null;

create trigger whatsapp_messages_touch_trg before update on public.whatsapp_messages
  for each row execute function public.touch_updated_at();

alter table public.whatsapp_messages enable row level security;
revoke all on table public.whatsapp_messages from anon, authenticated;

-- ------------------------------------------------------------- whatsapp_media
create table public.whatsapp_media (
  id                uuid primary key default gen_random_uuid(),
  agency_id         uuid not null references public.agencies (id) on delete restrict,
  message_id        uuid not null references public.whatsapp_messages (id) on delete restrict,
  provider          text not null default 'whatsapp_cloud',
  provider_media_id text not null,
  mime_type         text,
  filename          text,
  sha256            text,
  storage_path      text,
  file_size         bigint,
  width             integer,
  height            integer,
  download_status   text not null default 'received',
  download_attempts smallint not null default 0,
  last_error        text,
  downloaded_at     timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint whatsapp_media_provider_media_key unique (provider, provider_media_id),
  constraint whatsapp_media_storage_path_key unique (storage_path),
  constraint whatsapp_media_provider_check check (provider in ('whatsapp_cloud')),
  constraint whatsapp_media_provider_media_id_check
    check (btrim(provider_media_id) <> '' and char_length(provider_media_id) <= 255),
  constraint whatsapp_media_mime_type_format check (mime_type ~* '^[a-z0-9.+-]+/[a-z0-9.+-]+(\s*;.*)?$'),
  constraint whatsapp_media_filename_check check (filename is null or (btrim(filename) <> '' and char_length(filename) <= 255)),
  constraint whatsapp_media_sha256_format check (sha256 ~ '^[0-9a-f]{64}$'),
  constraint whatsapp_media_storage_path_format
    check (storage_path is null or storage_path like agency_id::text || '/%'),
  constraint whatsapp_media_file_size_check check (file_size > 0),
  constraint whatsapp_media_dimensions_check check ((width is null or width > 0) and (height is null or height > 0)),
  constraint whatsapp_media_download_status_check
    check (download_status in ('received', 'downloading', 'downloaded', 'failed', 'skipped')),
  constraint whatsapp_media_download_attempts_check check (download_attempts >= 0),
  constraint whatsapp_media_downloaded_consistency
    check (download_status <> 'downloaded' or (storage_path is not null and downloaded_at is not null))
);

comment on table public.whatsapp_media is
  'Media received on WhatsApp. Downloaded promptly into the private whatsapp-media bucket; provider URLs are never stored as permanent.';
comment on column public.whatsapp_media.storage_path is
  'Object path inside the private whatsapp-media bucket, always prefixed with the agency id.';

create index whatsapp_media_message_idx on public.whatsapp_media (message_id);
create index whatsapp_media_agency_sha256_idx on public.whatsapp_media (agency_id, sha256);
create index whatsapp_media_pending_idx
  on public.whatsapp_media (download_status, created_at)
  where download_status in ('received', 'downloading', 'failed');

create trigger whatsapp_media_touch_trg before update on public.whatsapp_media
  for each row execute function public.touch_updated_at();

alter table public.whatsapp_media enable row level security;
revoke all on table public.whatsapp_media from anon, authenticated;

-- --------------------------------------------------------- extraction_results
create table public.extraction_results (
  id                uuid primary key default gen_random_uuid(),
  agency_id         uuid not null references public.agencies (id) on delete restrict,
  session_id        uuid not null references public.submission_sessions (id) on delete restrict,
  property_id       uuid references public.properties (id) on delete set null,
  provider          text not null,
  model             text not null,
  prompt_version    text,
  input_message_ids uuid[] not null,
  status            text not null,
  extracted_data    jsonb,
  confidence        jsonb,
  error             text,
  validation_status text,
  validation_errors jsonb not null default '[]'::jsonb,
  created_at        timestamptz not null default now(),
  constraint extraction_results_provider_check check (btrim(provider) <> '' and char_length(provider) <= 60),
  constraint extraction_results_model_check check (btrim(model) <> '' and char_length(model) <= 120),
  constraint extraction_results_input_message_ids_check
    check (cardinality(input_message_ids) >= 1 and array_position(input_message_ids, null) is null),
  constraint extraction_results_status_check check (status in ('succeeded', 'invalid_output', 'failed')),
  constraint extraction_results_succeeded_has_data check (status <> 'succeeded' or extracted_data is not null),
  constraint extraction_results_extracted_data_object
    check (extracted_data is null or jsonb_typeof(extracted_data) = 'object'),
  constraint extraction_results_confidence_object check (confidence is null or jsonb_typeof(confidence) = 'object'),
  constraint extraction_results_validation_status_check
    check (validation_status in ('valid', 'invalid', 'needs_review')),
  constraint extraction_results_validation_errors_array check (jsonb_typeof(validation_errors) = 'array')
);

comment on table public.extraction_results is
  'Append-only history of AI extraction attempts. AI output is candidate data, never the source of truth. Only property_id and validation fields may be updated after insert.';

create index extraction_results_session_idx on public.extraction_results (session_id, created_at desc);
create index extraction_results_agency_idx on public.extraction_results (agency_id, created_at desc);
create index extraction_results_property_idx
  on public.extraction_results (property_id) where property_id is not null;

alter table public.extraction_results enable row level security;
revoke all on table public.extraction_results from anon, authenticated;
-- History must not be overwritten: the AI output of an attempt is immutable.
revoke update, delete, truncate on table public.extraction_results from service_role;
grant update (property_id, validation_status, validation_errors) on table public.extraction_results to service_role;

-- ----------------------------------------- properties <- submission_sessions link
-- One property per creating session (idempotent create from a session).
alter table public.properties
  add column created_from_session_id uuid
    references public.submission_sessions (id) on delete set null,
  add constraint properties_created_from_session_key unique (created_from_session_id);

comment on column public.properties.created_from_session_id is
  'Submission session that created this property. Unique, so replaying a session cannot create a second property.';
