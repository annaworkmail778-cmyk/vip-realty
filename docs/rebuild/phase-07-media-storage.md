# Phase 7 — WhatsApp Media Download, Storage and Property Images

Status: **complete (real Meta and Storage uploads require credentials that do not exist yet)**.
Branch `phase/07-media-storage` (from Phase 6.5 commit `8d75bab`).

> WhatsApp photo → media metadata (Phase 4) → download from Meta → private original → binary validation →
> gallery copy → `property_images` row on **the draft created from the same submission session**.
> Safe, idempotent and recoverable. Every property stays a private draft; nothing is published or approved.

**The existing WhatsApp group is NOT connected by this phase.** No group ingestion, no chat-export import,
no historical migration. Group media is stored as metadata only and marked `skipped`.

No secrets, tokens or credential values appear in this document or in the repository.

---

## 1. Audit — what existed before (inspected first)

| Object | Existing | Phase 7 |
| --- | --- | --- |
| `whatsapp_media` | provider media id (unique), `mime_type` (provider), `sha256`, `storage_path` (`{agency}/…`), `file_size`, `width/height`, `download_status` (received/downloading/downloaded/failed/skipped), `download_attempts`, `last_error`, `downloaded_at` | reused; state set extended, lease / deadline / validation / attachment columns added |
| ingestion (`ingest_whatsapp_message`) | inserts one `whatsapp_media` row per media message (duplicate provider media id → same row) | **unchanged**; a trigger sets the download deadline |
| `property_images` | `property_id`, `agency_id`, `media_id` (FK), `storage_path` = `properties/{property_id}/{file}.(jpg\|jpeg\|png\|webp\|avif)`, `sort_order` (unique per property, deferrable), unique (property, media) | reused as-is; + unique `media_id`, + provenance guard trigger |
| RLS | `property_images` readable by anon/authenticated **only for published properties** (column grants: no `media_id`/`agency_id`) | unchanged |
| `published_property_listings` | view, `listing_status = 'published'` only, images ordered by `sort_order` | unchanged |
| Storage | `property-images`: public-object bucket, 10 MiB, JPEG/PNG/WebP/AVIF, **no storage.objects policies** (no list/upload/delete for anon). `whatsapp-media`: private, 25 MiB | **unchanged** (no bucket or policy change) |
| Website | `publicImageUrl()` builds `/object/public/property-images/{path}` only for rows returned by the published view; legacy listings use `public/media/properties/*` | unchanged |
| Admin (server, service role) | lists a property's images and shows them via the public URL builder | unchanged |
| n8n | Inbound (Phase 4/6.5), Submission Extraction (5/6), AI sub-workflow | + *VIP Realty — Media Processing*; others unchanged |
| Tests | none for media | `automation/media/validate-image.test.mjs` (`npm run test:media`) |

Media lifecycle **before** Phase 7: metadata was stored at ingestion with `download_status = received` and nothing
ever downloaded it; Meta's media expires, so photos would have been lost.

## 2. Architecture

```
WhatsApp Inbound (Phase 4)          ── whatsapp_media: received (+ download deadline)
Submission Extraction (Phase 5/6)   ── session → valid extraction → draft property (unchanged)
Media Processing (Phase 7, every minute, independent)
  0. advance_media_pipeline         recovery sweep (skip ineligible, expire, reconcile, retry, record)
  1. download    claim → Meta media URL (trusted media id) → bytes → size/SHA-256 → private whatsapp-media → confirm
  2. validation  claim → read stored original → validate bytes → record verdict (validated | rejected)
  3. attachment  claim (only when the trusted association is eligible) → copy to property-images → complete
```

The database decides everything: eligibility, deterministic paths, the target property, gallery order, limits,
retries and expiry. The n8n worker only moves bytes and reports facts, and every fact is re-checked against
`storage.objects` / `storage.buckets`. The stages are independent: a media failure never touches the draft
(tested: draft row md5 unchanged across all media processing).

Photos are downloaded **as soon as they arrive** (not when the draft exists): the session's 5-minute quiet period
and the extraction happen in parallel, so the original is secured within about a minute, well inside Meta's window.

## 3. Media state machine (`whatsapp_media.download_status`)

```
received ──claim──▶ downloading ──complete──▶ downloaded ──claim──▶ validating ──verdict──▶ validated
   │                    │  (object verified in storage.objects)          │                     │
   │                    ├─ transient → received (backoff)                ├─ transient → downloaded (backoff)
   │                    ├─ permanent / budget spent → failed             └─ invalid → rejected
   │                    ├─ empty / oversized → rejected                                        │
   │                    └─ window passed → expired              claim (only if association is eligible)
   ├─ never eligible → skipped                                                                 ▼
   └─ window passed → expired        attached ◀── record image ◀── uploaded ◀──complete── attaching
                                          (property_images row)   (object verified)   ├─ transient → validated (backoff)
                                                                                      └─ budget spent → failed
validated with an ineligible association stays validated, status_reason = held:<reason>
```

| State | Meaning | Lease |
| --- | --- | --- |
| `received` | metadata only | – |
| `downloading` | worker fetching from Meta and storing the private original | yes |
| `downloaded` | original verified in `whatsapp-media` (object exists, size matches) | – |
| `validating` | worker validating the stored original | yes |
| `validated` | valid image; waits for an eligible draft (`status_reason = held:<reason>` while waiting) | – |
| `attaching` | worker copying to `property-images` | yes |
| `uploaded` | gallery object verified, `property_images` row not yet written | – |
| `attached` | **success: Storage object AND `property_images` row exist** | – |
| `rejected` | empty / oversized / corrupt / unsupported / mime_not_allowed / size or hash mismatch — reviewable, original kept privately | – |
| `failed` | permanent provider error or retry budget spent (`failed_stage`) — reviewable, `request_media_reprocessing` requeues | – |
| `expired` | Meta's download window passed before the original was secured — reviewable, metadata kept | – |
| `skipped` | never eligible: unresolved sender, group, ignored (cancelled) message, not a photo (sticker/video/audio/other document) | – |

Leases: 300 s (`lease_attempt_id`, `lease_expires_at`, `lease_worker`); every completion must present the attempt id
(stale attempts are refused; the same attempt returns `duplicate`). Attempts: download 6, validation 4, attachment 6;
backoff 60 s × 2^(n−1), max 1 h (`media_pipeline_config()`). The n8n execution timeout (180 s) is shorter than the lease.

## 4. WhatsApp download flow (n8n *Media Processing*, inactive)

1. `claim_media_downloads` returns the **provider media id captured at ingestion**, the deterministic private path and
   the size limit (from `storage.buckets`).
2. *Resolve media URL (Meta)* — WhatsApp Business Cloud node, `media → mediaUrlGet` (official Graph API) with the
   `whatsAppApi` credential.
3. *Check media URL* — follows only `https://` URLs on Meta media hosts (`fbsbx.com`, `whatsapp.net`, `facebook.com`,
   `fbcdn.net`); rejects a provider-reported size above the limit; a missing URL/error result is a **retryable** provider
   failure (the WhatsApp node reports errors on its main output — found and fixed during testing).
4. *Download media binary (Meta)* — HTTP GET with the same credential (bearer token stays in n8n).
5. *Verify download* — size and SHA-256 computed from the bytes and compared with Meta's reported `file_size` / `sha256`
   (hex or base64).
6. *Store original* — `POST storage/v1/object/whatsapp-media/{path}` with `x-upsert: false` (never overwrites; an
   existing object is accepted only if the database confirms its size).
7. `complete_media_download` — verifies the object in `storage.objects` (exists, same size) → `downloaded`.

No URL from a message, the AI or any other source is ever followed. Credentials never reach Next.js.

## 5. Media expiry

`download_deadline_at` = earliest of the message's provider timestamp / receipt time + **7 days**
(`media_pipeline_config.download_window_seconds`, per the Phase 6.5 discovery; verify with Meta, see §17). Set by a
`BEFORE INSERT` trigger on `whatsapp_media`, so ingestion is unchanged. Past the deadline:
`received` → `expired` (sweep); a download failing after the deadline → `expired`; `request_media_reprocessing` refuses
to requeue it. The message, session and metadata are never deleted.

## 6. Binary validation (`automation/media/validate-image.js`)

Pure JavaScript, embedded verbatim in three Code nodes (a test fails if the export drifts from the file):

- format detected **from the bytes** (JPEG, PNG, WebP, AVIF/ISO-BMFF brands); declared MIME and file name ignored;
- structure walked end to end: JPEG segments + frame header + end-of-image marker; PNG chunk bounds and **CRC of every
  chunk**, IHDR first, IEND last, nothing after; WebP RIFF size = file size, chunk bounds, VP8/VP8L/VP8X headers;
  AVIF box sizes add up exactly, `ftyp`/`meta`/`mdat`, `ispe` dimensions;
- limits: allowed formats and max bytes **read from `storage.buckets` (`property-images`)** — unchanged 10 MiB and
  JPEG/PNG/WebP/AVIF; dimensions 1…20000 px per side, ≤ 100 MP;
- codes: `empty_file`, `oversized`, `unsupported_format`, `corrupt_image`, `dimensions_out_of_range`,
  `mime_not_allowed`.

The database re-checks the verdict (`record_media_validation`): size equals the stored original, SHA-256 equals the
download hash, detected type in the bucket's allow-list, size within the bucket limit, dimensions in range. A worker
claiming "valid GIF" is rejected (tested). No AI image analysis, OCR, captions or enhancement.

## 7. Storage paths (deterministic, database-generated)

| Bucket | Path | Notes |
| --- | --- | --- |
| `whatsapp-media` (private) | `{agency_id}/{yyyy}/{mm}/{media_id}.{ext}` | existing convention; ext from the provider type; format-checked (`^{agency}/\d{4}/\d{2}/{id}\.[a-z0-9]{2,5}$`) |
| `property-images` | `properties/{property_id}/{media_id}.{ext}` | existing convention (enforced by the `property_images` check and the website's path validator); ext from the **detected** type |

All components are UUIDs, digits or a fixed extension: no traversal, no user/AI-controlled segment, retries always
resolve to the same object, uploads use `x-upsert: false`, and an existing object with a different size is a
`storage_object_conflict` (failed, reviewable) — never overwritten. The agency is not a path segment of the public copy
because the existing public convention and the website validator are `properties/{property}/…`; agency ownership is
enforced by the database (`property_images.agency_id` must equal the property's agency).

## 8. Property association (trusted relationships only)

`media_property_association(media_id)` is the only way a target is chosen:

```
whatsapp_media → whatsapp_messages (same agency, image, direct, resolved agent)
  → submission_sessions (message.session_id; same agency; same agent)
  → agents (active, same agency as the session)
  → properties.created_from_session_id = session.id (same agency, same agent, source whatsapp, listing_status draft)
  → extraction_results (succeeded + valid, linked to that property)
```

Hold reasons (stays `validated`, retried every run): `session_pending`, `no_property` (invalid / incomplete / conflicting
extraction), `session_cancelled`, `agent_inactive`, `agency_mismatch`, `property_not_draft`, `property_mismatch`,
`extraction_not_valid`, `no_session`, `session_mismatch`. No function takes a property id, path, agent or agency as
input; the `property_images_provenance_guard` trigger re-checks the association, the agency and the exact path on every
insert and makes provenance (property, agency, media, path) immutable.

## 9. Provenance

`property_images` (property, agency, media, path, order, width, height) → `whatsapp_media` (provider media id,
provider MIME, detected MIME, size, SHA-256, private original path, deadline, attempts, validated/attached timestamps,
status reason) → `whatsapp_messages` (WhatsApp message, timestamp, sender) → `submission_sessions` → agent/agency.
`automation_events` records every transition (`media.downloaded`, `.validated`, `.rejected`, `.attached`,
`.attachment_held`, `.retry_scheduled`, `.failed`, `.expired`, `.skipped`, `.reconciled`, `.image_record_failed`,
`.requeued`) with the media id. No provenance is duplicated onto `property_images`.

## 10. Image ordering

`sort_order` = rank of the photo among all photos of the session by (WhatsApp timestamp, provider message id, media
id). It does not depend on processing order, retries or AI output (tested: validated in reverse order, attached out of
order → 0, 1, 2, 3 …). Rejected/failed photos keep their rank, so later images never move (gaps are harmless; the
website sorts by `sort_order`). `is_primary` stays false; the cover is the lowest `sort_order`.

## 11. Idempotency

| Case | Mechanism | Tested |
| --- | --- | --- |
| duplicate webhook | unique `(provider, provider_message_id)` → one message, one media | ✓ |
| same media id in another message | unique `(provider, provider_media_id)` → one media, one image | ✓ |
| n8n retry of a completion | same attempt id → `duplicate` with the existing result | ✓ (download + attachment) |
| retry after timeout / crash | lease expiry → sweep reconciles from `storage.objects` or retries with backoff | ✓ |
| upload ok, DB insert failed | stays `uploaded` → sweep records the row | ✓ (injected failure) |
| DB insert ok, workflow retries | `duplicate` returns the existing image | ✓ |
| same photo sent twice | two messages → two media → two images (no hash collapsing) | ✓ |
| one image per media | unique `property_images(media_id)` | ✓ |

## 12. Retry and recovery (`advance_media_pipeline`, first node of every run)

1. `received` media that can never be processed → `skipped` (reason).
2. `received` past the deadline → `expired`.
3. expired leases: `downloading` with a stored original → `downloaded` (reconciled); `attaching` with the gallery object
   → `uploaded` (reconciled); otherwise a bounded retry / `failed` / `expired`.
4. `uploaded` → write the missing `property_images` row.

Safe to run repeatedly (tested twice in a row: no changes). Permanent failures never loop: they end in `rejected`,
`failed`, `expired` or `skipped`, all reviewable; `request_media_reprocessing(media_id)` requeues a `failed` item.

## 13. Security

- No bucket or policy was changed or weakened. `whatsapp-media` stays private; neither bucket has `storage.objects`
  policies, so anon cannot list, upload or delete (tested).
- `whatsapp_media`, `whatsapp_messages`, `automation_events`: RLS on, no anon/authenticated grants (tested 401).
- `property_images`: anon/authenticated see rows only of published properties, never `media_id`/`agency_id` (tested).
- All 20 new functions (18 callable + 2 trigger functions): `SECURITY INVOKER`, `EXECUTE` revoked from `public`,
  `anon`, `authenticated`, granted to `service_role` only (verified in `pg_proc`; anon RPC calls return 401).
- Error text stored in `last_error` passes through `redact_error_text`; signed URL query strings are stripped in n8n.
- **Residual (documented):** `property-images` is a public-object bucket (existing design for published listings).
  A draft image is served to anyone who already knows its exact URL. The URL contains two random UUIDs (draft id and
  media id) and is disclosed by no public query, listing, route or Storage listing — it is not discoverable. A later
  phase may move draft copies to a private bucket and copy them to the public bucket at publication.

## 14. Public safety evidence (anon key, live project)

| Check | Result |
| --- | --- |
| `published_property_listings` | `[]` (drafts absent) |
| `properties?slug=<draft>` | `[]` |
| `property_images?property_id=<draft>` / all rows | `[]` / `[]` |
| `property_images?select=media_id` | 401 (column not granted) |
| `POST property_images`, `POST whatsapp_media`, `GET whatsapp_media` | 401 |
| RPC `claim_media_downloads`, `advance_media_pipeline`, `media_property_association` | 401 |
| Storage list `property-images/properties/`, `…/<draft>/`, `whatsapp-media` | `[]` |
| Storage upload to either bucket | 403 (RLS) |
| Storage delete of a draft object | nothing deleted (object row verified still present) |
| `whatsapp-media` via public URL / authenticated endpoint | bucket not found / not found |
| website `/properties/<draft slug>` (production build, publishable key) | **404** for both test drafts; `/properties` and `/` contain no draft slug, id or media path |
| legacy local images `public/media/properties/*` | 13 files unchanged; legacy rendering untouched |

## 15. n8n changes

New workflow **VIP Realty — Media Processing** (`automation/n8n/vip-realty-media-processing.json`, 45 nodes incl.
3 notes, **inactive**, settings: timeout 180 s, failed executions saved, successful execution data not saved):

| Stage | Nodes |
| --- | --- |
| trigger + sweep | *Every minute* → *Advance media pipeline (recovery sweep)* |
| download | *Claim media downloads* → *Split claimed downloads* → *Resolve media URL (Meta)* → *Check media URL* → *URL trusted and size allowed?* → *Download media binary (Meta)* → *Verify download* → *Download verified?* → *Store original (private whatsapp-media)* → *Classify original upload* → *Original stored?* → *Confirm download (Supabase)*; failures → *Classify provider failure* / *Classify storage failure (download)* → *Record download failure (Supabase)* |
| validation | *Claim media validations* → *Split claimed validations* → *Read original (private)* → *Validate image* → *Record validation (Supabase)*; read errors → *Classify storage failure (validation)* → *Record validation failure (Supabase)* |
| attachment | *Claim media attachments* → *Split claimed attachments* → *Read validated original (private)* → *Verify gallery copy source* (byte-identical to the validated original) → *Source intact?* → *Upload gallery image (property-images)* → *Classify gallery upload* → *Gallery image stored?* → *Complete attachment (Supabase)*; failures → *Classify storage failure (…)* → *Record attachment failure (Supabase)* |

Credentials (pending, by name only): `VIP Realty WhatsApp Cloud API (access token)` (`whatsAppApi`) and
`VIP Realty Supabase (service role)` (`supabaseApi`). Other workflows unchanged.

## 16. Tests

**Where the evidence comes from**

- *Validator (local, real bytes)* — `npm run test:media`: 11 tests over synthetic JPEG/PNG/WebP (lossy + lossless)/AVIF/GIF
  fixtures generated with sharp (`automation/media/fixtures/zz-phase7-test*`), truncations, bit damage, disguised files,
  limits, and the export-drift check. 11/11 pass.
- *n8n (real Code runtime, mocked provider)* — executions 27/30 (Meta, Storage and Supabase responses pinned; fixture
  bytes as binary) and 28/29 (Meta call left unpinned → real failure without credentials).
- *Database (live project)* — `zz-phase7-test-*` agencies/agents/messages driven through ingestion, sessions,
  extraction, drafts and the full media pipeline as `service_role`. **Storage was simulated at the metadata level**:
  the object rows the Storage API would write were inserted into `storage.objects` (no files), because no service-role
  key is available outside n8n; the database checks only these rows.
- *Public safety* — real anonymous REST/Storage calls and the production website (above).

**Failure matrix**

| # | Scenario | Result |
| --- | --- | --- |
| 1 | Provider unavailable (no credential / no URL) | PASS — n8n → `provider_unavailable`, retryable (exec 29; exec 28 found the bug) |
| 2 | Provider HTTP error (503) | PASS — back to `received` with backoff, secret in message redacted; n8n HTTP-status classification by inspection only |
| 3 | Provider timeout | PASS — 5× retry, 6th → `failed` (budget), manual requeue works |
| 4 | Media deadline expired | PASS — `received` → `expired`; lease ending after the deadline → `expired`; requeue refused; message/session kept |
| 5 | Empty binary | PASS — `rejected empty_file` (DB) + validator |
| 6 | Invalid image | PASS — truncated PNG → `rejected corrupt_image` (validator, n8n, DB) |
| 7 | Unsupported MIME | PASS — GIF → `unsupported_format`; lying worker "valid GIF" → `mime_not_allowed` |
| 8 | Oversized image | PASS — Meta-reported 50 MB (n8n), worker report → `rejected oversized`, validator limit |
| 9 | Storage upload failure | PASS — gallery upload fails → `validated` + backoff → next claim attaches |
| 10 | Database failure after upload | PASS — injected insert failure → `uploaded` → sweep writes the row |
| 11 | Database failure before upload | PASS — worker crash without upload → lease expiry → retry → success |
| 12 | Duplicate webhook | PASS — one media row |
| 13 | Duplicate media ID | PASS — new message with the same provider media id → same media, one image |
| 14 | n8n retry | PASS — same attempt → `duplicate` (download and attachment), stale attempt refused |
| 15 | Recovery sweep | PASS — reconciled lost confirmation (download) and crash after upload (attachment); repeated sweeps no-op |
| 16 | Two concurrent processing attempts | PASS (sequential) — leased rows are never re-claimed, stale attempt refused; claims use `FOR UPDATE SKIP LOCKED` (parallel connections not executable here) |
| 17 | Several images, same session | PASS — 7 images on one draft, one property; orders 0,1,2,3,10,11,12 |
| 18 | Two different sessions | PASS — S2's 2 images only on S2's draft; cross-insert denied |
| 19 | Unknown sender | PASS — `skipped sender_unresolved`, never downloaded |
| 20 | Inactive sender | PASS — `skipped` at ingestion time; deactivated after the draft → `held:agent_inactive`, attached after reactivation |
| 21 | Agency mismatch | PASS — other-agency agent `skipped`; agent moved → `held:agency_mismatch` |
| 22 | Missing property | PASS — `held:session_pending` before drafts; incomplete extraction → `held:no_property` |
| 23 | Existing draft, successful retry | PASS — draft row md5 identical before/after all media work |

**Security matrix**

| # | Check | Result |
| --- | --- | --- |
| 1 | Anonymous Storage read denied where required | PASS (private bucket; no listing; see residual §13) |
| 2 | Anonymous Storage write denied | PASS (upload 403, delete removes nothing) |
| 3 | Anonymous `property_images` insert denied | PASS (401) |
| 4 | Anonymous `property_images` read of a draft | PASS (`[]`) |
| 5 | Cross-agency association denied | PASS |
| 6 | Cross-session association denied | PASS |
| 7 | Invalid property association denied | PASS |
| 8 | AI cannot select property id | PASS (no such input; guard) |
| 9 | AI cannot select storage path | PASS (database-generated; immutable) |
| 10 | Path traversal rejected | PASS (both tables) |
| 11 | Unsupported binary rejected | PASS |
| 12 | Oversized binary rejected | PASS |
| 13 | Legacy properties unchanged | PASS (fingerprint `dd176f32…`; RSVP `090be351…`) |

Cleanup: all `zz-phase7-test` agencies, agents, sessions, messages, media, extraction results, properties, images,
automation events and simulated Storage rows deleted; counts 0; `storage.objects` 0; no helper functions/triggers left.
n8n test executions 27–30 contain only synthetic data and can be deleted in the n8n UI.

## 17. What requires real Meta credentials (not verifiable here)

- the actual Graph API media URL response and the lookaside download (`whatsAppApi` credential);
- Meta's real media retention window (7 days assumed) and the `sha256` representation in the media endpoint;
- real Storage uploads/downloads from n8n (needs the `supabaseApi` credential): `x-upsert: false` duplicate response
  shape, private reads;
- end-to-end latency. Before activation: create both credentials, send one real photo from a test number, confirm
  `downloaded → validated → attached`, then activate *Media Processing*.

## 18. Migration and rollback

`supabase/migrations/20260918203459_media_storage_pipeline.sql` (local copy identical to the applied statements).

Rollback (keep objects; nothing is deleted automatically):

```sql
drop trigger property_images_provenance_guard_trg on public.property_images;
drop trigger whatsapp_media_set_deadline_trg on public.whatsapp_media;
drop function public.advance_media_pipeline(text), public.request_media_reprocessing(uuid, text),
  public.claim_media_downloads(text, integer), public.complete_media_download(uuid, uuid, bigint, text, text),
  public.claim_media_validations(text, integer, uuid), public.record_media_validation(uuid, uuid, jsonb, text),
  public.claim_media_attachments(text, integer, text), public.complete_media_attachment(uuid, uuid, text),
  public.record_media_failure(uuid, uuid, text, text, boolean, text), public.media_record_image(uuid, text),
  public.media_stage_failure(uuid, text, text, boolean, text), public.media_event(public.whatsapp_media, text, text, text, jsonb, uuid),
  public.media_storage_object_size(text, text), public.media_target_path(uuid, uuid, text),
  public.property_images_provenance_guard(), public.whatsapp_media_set_deadline(),
  public.media_property_association(uuid), public.media_is_image(text, text), public.media_file_extension(text),
  public.media_pipeline_config();
drop index public.property_images_media_key, public.whatsapp_media_due_idx, public.whatsapp_media_lease_idx,
  public.whatsapp_media_target_property_idx;
alter table public.whatsapp_media
  drop constraint whatsapp_media_download_status_check, drop constraint whatsapp_media_storage_path_format,
  drop constraint whatsapp_media_stored_consistency, drop constraint whatsapp_media_validated_consistency,
  drop constraint whatsapp_media_attached_consistency, drop constraint whatsapp_media_lease_consistency,
  drop constraint whatsapp_media_target_consistency, drop constraint whatsapp_media_failed_consistency,
  drop constraint whatsapp_media_failed_stage_check, drop constraint whatsapp_media_detected_mime_check,
  drop constraint whatsapp_media_attempts_check, drop constraint whatsapp_media_status_reason_check,
  drop constraint whatsapp_media_lease_worker_check;
-- only after mapping any new states back to received/downloaded/failed/skipped:
alter table public.whatsapp_media
  drop column download_deadline_at, drop column detected_mime_type, drop column validated_at, drop column attached_at,
  drop column validation_attempts, drop column attach_attempts, drop column lease_attempt_id, drop column lease_expires_at,
  drop column lease_worker, drop column next_attempt_at, drop column target_property_id, drop column failed_stage,
  drop column status_reason,
  add constraint whatsapp_media_download_status_check check (download_status in ('received', 'downloading', 'downloaded', 'failed', 'skipped')),
  add constraint whatsapp_media_downloaded_consistency check (download_status <> 'downloaded' or (storage_path is not null and downloaded_at is not null)),
  add constraint whatsapp_media_storage_path_format check (storage_path is null or storage_path like agency_id::text || '/%');
create index whatsapp_media_pending_idx on public.whatsapp_media (download_status, created_at)
  where download_status in ('received', 'downloading', 'failed');
```

n8n: deactivate/archive *VIP Realty — Media Processing*.

## 19. Known limitations

- Real Meta and Storage I/O not executed (credentials pending, §17); Storage behaviour verified at the metadata level.
- Draft gallery copies live in the public-object bucket at unguessable, undisclosed paths (§13 residual).
- Structural validation, not full pixel decoding (no image library in n8n Code nodes); a structurally valid file with
  corrupt compressed pixel data would pass. Mitigation: Meta re-encodes photos; the admin reviews every draft.
- Only WhatsApp `image` messages and image-typed documents are processed; stickers/video/audio are skipped.
- True multi-connection concurrency is not testable through the SQL tool; locking design as in Phases 5/6.
- No admin UI for reviewing `rejected`/`failed`/`expired`/held media yet (Phase 8+).
