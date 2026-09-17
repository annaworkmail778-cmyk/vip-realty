# Phase 1 — Supabase Foundation

Status: **complete**. Branch `phase/01-supabase-foundation`.

> **Supabase is now the intended source of truth for the future property system, but the existing
> Next.js application has not yet been migrated to it.** The website still reads `lib/properties.ts`
> and the booking system is unchanged.
>
> **WhatsApp/n8n automation has NOT been implemented yet.** This phase only creates the database
> state, constraints and storage that automation will use.

No secrets, keys or environment values appear in this document.

---

## 1. What was created

| Kind | Object |
| --- | --- |
| New tables | `agencies`, `agents`, `submission_sessions`, `whatsapp_messages`, `whatsapp_media`, `extraction_results`, `property_images`, `inquiries`, `automation_events` |
| Extended table | `properties` (non-destructive, see §4) |
| View | `published_property_listings` (`security_invoker`) |
| Trigger function | `properties_listing_lifecycle()` |
| RLS policies | `properties_public_read_published`, `property_images_public_read_published` |
| Storage buckets | `property-images` (public), `whatsapp-media` (private) |

Project: the existing connected Supabase project (the one referenced by `.env.local`). Region and
shared-project concerns from the audit still apply (§12).

## 2. Migrations

Applied in this order and stored in `supabase/migrations/` with the versions recorded by Supabase:

| Version | File | Purpose |
| --- | --- | --- |
| 20260917132037 | `20260917132037_realty_foundation_01_organizations_and_properties.sql` | agencies, agents, `properties` extension, lifecycle trigger |
| 20260917132205 | `20260917132205_realty_foundation_02_whatsapp_pipeline.sql` | sessions, messages, media, extraction results, `properties.created_from_session_id` |
| 20260917132250 | `20260917132250_realty_foundation_03_images_inquiries_events.sql` | property images, inquiries, automation events |
| 20260917132321 | `20260917132321_realty_foundation_04_public_read_model.sql` | public column grants, RLS policies, read view |
| 20260917132338 | `20260917132338_realty_foundation_05_storage_buckets.sql` | storage buckets |

Every table is created with RLS enabled and `anon` / `authenticated` privileges revoked **in the same
migration**. This project's default privileges grant those roles full access to new tables, so this is
required, not optional.

The five pre-existing local booking migrations (`20260912090000`–`20260912091000`) were not touched.
Their remote counterparts have different versions and names (pre-existing drift, see §12).

## 3. Schema overview

```text
agencies
 ├── agents
 ├── properties ──────────────┬── property_images ── (media_id) ──┐
 │        ▲                    └── inquiries                        │
 │        │ property_id / created_from_session_id                  │
 ├── submission_sessions ──┬── whatsapp_messages ── whatsapp_media ─┘
 │                         └── extraction_results
 ├── inquiries
 └── automation_events (optional links to session / message / property)
```

### Relationships and delete behaviour

| Child → parent | On delete | Reason |
| --- | --- | --- |
| everything → `agencies` | RESTRICT | agencies are never deleted implicitly |
| `agents` referenced by sessions / messages | RESTRICT | deactivate agents (`is_active`) instead of deleting history |
| `properties.agent_id` → `agents` | SET NULL | a listing survives its agent |
| `whatsapp_messages.session_id` → sessions | RESTRICT | message history is never cascade-deleted |
| `whatsapp_media.message_id` → messages | RESTRICT | media history is never cascade-deleted |
| `extraction_results.session_id` → sessions | RESTRICT | extraction history is kept |
| `submission_sessions.property_id`, `extraction_results.property_id`, `inquiries.property_id`, `automation_events.*` | SET NULL | removing a property keeps all history and leads |
| `property_images.property_id` → properties | CASCADE | image rows belong to the property (Storage objects must be cleaned up separately) |
| `property_images.media_id` → media | SET NULL | deleting an image never deletes the WhatsApp original |
| `properties.created_from_session_id` → sessions | SET NULL | |

## 4. Property model

`public.properties` was **extended in place**, because the booking system still references it (foreign
keys from four `viewing_*` tables and two booking functions). Nothing was dropped and no existing row
value was changed.

### Changes to existing columns

| Column | Change | Why |
| --- | --- | --- |
| `title`, `location`, `property_type` | `NOT NULL` dropped | incomplete WhatsApp drafts must be storable |
| `property_type` | default `'apartment'` dropped | a default would be a fake value |
| `price_period` | check widened from (`month`,`year`) to (`month`,`day`,`year`) | daily rentals |

Booking functions only read `properties.id`, `viewing_mode` and `viewing_duration_minutes`; these are
unchanged (verified by executing the booking functions after migration).

### New columns (all nullable unless stated)

| Group | Columns |
| --- | --- |
| Identity / ownership | `agency_id`, `agent_id`, `source` (`whatsapp`/`admin`/`import`/`seed`), `created_from_session_id` (unique) |
| Lifecycle | `listing_status` NOT NULL default `draft`, `review_status`, `listing_status_changed_at` NOT NULL, `published_at` |
| Listing | `intent` (`buy`/`rent`), `description` (reuses existing `slug`, `title`, `property_type`) |
| Location | `country` (ISO-3166 alpha-2), `city`, `district`, `latitude`, `longitude` (reuses existing `address`) |
| Commercial | `currency` (`USD`/`AMD`/`EUR`/`RUB`), `price_negotiable` (reuses `price`, `price_period`) |
| Characteristics | `area_sqm`, `land_area_sqm`, `rooms`, `bedrooms`, `bathrooms`, `floor`, `total_floors`, `year_built` |
| Marketing | `features` text[] NOT NULL default `{}`, `featured` NOT NULL default false (reuses `metadata`) |

### Price semantics

| Example | Representation |
| --- | --- |
| sale price | `intent = 'buy'`, `price_period IS NULL` (enforced: a sale cannot have a period) |
| monthly rent | `intent = 'rent'`, `price_period = 'month'` |
| daily rent | `intent = 'rent'`, `price_period = 'day'` |
| negotiable | `price_negotiable = true` (independent of period) |

### Nullability rules

Unknown values stay `NULL`. The database rejects the usual substitutes for unknown data:
blank strings (`title`, `description`, `city`, `district`, `address`), a price of `0`, malformed feature
codes, invalid enumerations, floor above total floors, half-set coordinates.
`features` and `featured` have real defaults (empty list / not featured), not placeholders.

### Legacy columns (kept, documented as legacy in column comments)

`status` (booking availability), `location`, `viewing_mode`, `viewing_duration_minutes`, `images`
(JSON, unused). They are removed together with booking in a later phase. The six existing rows keep all
original values; their new columns are `NULL` and `listing_status = 'draft'`, so they are **not**
publicly visible.

## 5. Lifecycle / status model

Public listing state (`properties.listing_status`) is separate from human review
(`properties.review_status`) and from automation processing (`submission_sessions.status`,
`whatsapp_messages.processing_status`, `whatsapp_media.download_status`).

### `listing_status` transitions (enforced by trigger for every writer)

| From | Allowed to |
| --- | --- |
| `draft` | `published`, `archived` |
| `published` | `draft`, `sold`, `rented`, `archived` |
| `sold` | `published`, `archived` |
| `rented` | `published`, `archived` |
| `archived` | `draft` |

The trigger also sets `listing_status_changed_at` and `published_at`.

### Publish rules (check constraints)

A row can only be `published` when all of: `review_status = 'approved'`, `title`, `intent`,
`property_type`, `city`, `price` and `currency` are present. `published`/`sold`/`rented` rows must have
`agency_id`. `sold` requires `intent = 'buy'`; `rented` requires `intent = 'rent'`.
AI/automation therefore cannot publish an unreviewed or incomplete listing, regardless of what it writes.

### Other status sets

| Table.column | Values |
| --- | --- |
| `properties.review_status` | `pending`, `approved`, `rejected` (NULL = not yet in review) |
| `submission_sessions.status` | `open`, `ready`, `processing`, `needs_review`, `completed`, `cancelled`, `failed` |
| `whatsapp_messages.processing_status` | `received`, `buffered`, `processing`, `processed`, `failed`, `ignored` |
| `whatsapp_media.download_status` | `received`, `downloading`, `downloaded`, `failed`, `skipped` |
| `extraction_results.status` / `validation_status` | `succeeded`, `invalid_output`, `failed` / `valid`, `invalid`, `needs_review` |
| `inquiries.status` | `new`, `contacted`, `closed` |

Media is "attached to a property" when a `property_images` row references it (`media_id`).

## 6. WhatsApp session model

```text
message 1 "2 bedroom apartment Arabkir" ┐
message 2 "85 sqm"                      │
message 3 "$180,000"                    ├─ whatsapp_messages.session_id ─► ONE submission_session ─► ONE property
message 4 [photo] ─ whatsapp_media      │                                   (property_id / created_from_session_id)
message 5 "5th floor, renovated"        ┘
```

* `channel_conversation_key` = the sender's E.164 phone number for WhatsApp.
* At most one `open` session per `(agency_id, channel, channel_conversation_key)` — partial unique index.
* `last_message_at` and `process_after` (debounce deadline) hold the buffering state; `close_reason`
  records why a session closed.
* Grouping is **deterministic application/n8n logic** (later phase). AI does not decide session membership.
* `extraction_results` keeps every AI attempt for a session (append-only), with the exact
  `input_message_ids`, `extracted_data`, `confidence`, and `validation_errors`.
* `automation_events` is a lightweight append-only trail (`whatsapp.received`, `session.buffered`,
  `extraction.completed`, `validation.failed`, `property.created`, `media.downloaded`,
  `property.published`, …) with a `correlation_id` for the n8n execution.

## 7. Idempotency strategy (database-enforced)

| Duplicate event | Constraint |
| --- | --- |
| Same WhatsApp webhook delivered again | `whatsapp_messages_provider_message_key` UNIQUE (`provider`, `provider_message_id`) → insert with `ON CONFLICT DO NOTHING` |
| Same media id | `whatsapp_media_provider_media_key` UNIQUE (`provider`, `provider_media_id`) |
| Two concurrent "open session" inserts | `submission_sessions_one_open_per_conversation` partial UNIQUE |
| Session replayed into a second property | `properties_created_from_session_key` UNIQUE (`created_from_session_id`) |
| Same slug | `properties_slug_key` UNIQUE (global, as before) |
| Same storage object recorded twice | `property_images_storage_path_key`, `whatsapp_media_storage_path_key` UNIQUE |
| Same media attached twice to a property | `property_images_property_media_key` partial UNIQUE |
| Two primary images / two images at one position | `property_images_one_primary`, `property_images_sort_order_key` (deferrable) |
| Double-submitted inquiry | `inquiries_client_submission_key` partial UNIQUE (`agency_id`, `client_submission_id`) |
| Agent registered twice for one WhatsApp number | `agents_agency_whatsapp_phone_key` UNIQUE |
| AI output overwritten | `UPDATE`/`DELETE` revoked on `extraction_results` for `service_role` (only `property_id`, `validation_status`, `validation_errors` updatable) |
| Event history edited | `UPDATE`/`DELETE` revoked on `automation_events` for `service_role` |

Writers should use `INSERT … ON CONFLICT` against these constraints instead of select-then-insert.

## 8. Storage strategy

| Bucket | Public | Limit | Allowed types | Path convention | Written by |
| --- | --- | --- | --- | --- | --- |
| `property-images` | **yes** | 10 MB | jpeg, png, webp, avif | `properties/{property_id}/{uuid}.{ext}` (enforced on `property_images.storage_path`) | server only |
| `whatsapp-media` | **no** | 25 MB | any | `{agency_id}/{yyyy}/{mm}/{whatsapp_media.id}.{ext}` (agency prefix enforced) | server only |

* Public URL is deterministic, not stored:
  `{NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/property-images/{storage_path}`.
* No `storage.objects` policies exist, so `anon`/`authenticated` cannot list, upload, update or delete in
  either bucket. Only the service role (Next.js server, n8n) writes.
* WhatsApp media is downloaded promptly into `whatsapp-media`; temporary provider URLs are never stored.
* **Security implication of the public bucket:** any object in `property-images` is readable by anyone
  who knows its URL, regardless of the listing's status. Paths contain random UUIDs (not guessable and
  not listable), but draft photos placed there are technically reachable. Therefore: raw WhatsApp media
  and anything that may contain personal documents stay in the private bucket, and only images intended
  for the gallery are copied to `property-images` (recommended: at publish time, decided in the media
  pipeline phase).

## 9. RLS / security model

| Object | anon / authenticated | service_role |
| --- | --- | --- |
| `properties` | SELECT on public columns only, rows where `listing_status = 'published'` | full |
| `property_images` | SELECT on public columns, rows whose property is published | full |
| `published_property_listings` (view) | SELECT (same RLS/column rules, `security_invoker`) | full |
| `agencies`, `agents`, `submission_sessions`, `whatsapp_messages`, `whatsapp_media`, `extraction_results`, `inquiries`, `automation_events` | **no privileges** (RLS on, no policies) | full, except append-only rules in §7 |
| Storage | public object URLs of `property-images` only | full |

Public property columns: `id, agency_id, slug, title, description, listing_status, intent, property_type,
country, city, district, price, currency, price_period, price_negotiable, area_sqm, land_area_sqm, rooms,
bedrooms, bathrooms, floor, total_floors, year_built, features, featured, published_at, created_at,
updated_at`.

**Not public:** `address`, `latitude`, `longitude` (address visibility undecided), `metadata`,
`agent_id`, `review_status`, `source`, `created_from_session_id`, and all legacy booking columns.

Inquiries are never written by the browser: the intended path is website form → Next.js server route →
validation → insert with the service role. The service-role key must never reach client code
(`lib/env.ts` and `lib/supabase/admin.ts` are already `server-only`).

The new trigger function has a pinned `search_path` and no `EXECUTE` for `anon`/`authenticated`.

## 10. Verification results

All checks were run against the live project. Behavioural tests ran inside one transaction that was
deliberately rolled back, so **no test data remains** (all new tables verified empty afterwards).

**66 / 66 behavioural tests passed:**

| Area | Tests |
| --- | --- |
| Agency / agent | agent belongs to agency; agency FK enforced; WhatsApp number unique per agency; E.164 phone format |
| Property | draft with only a few fields, all unknowns NULL; slug unique; invalid `listing_status` and `intent` rejected; blank text rejected; zero price rejected; incomplete publish rejected; unapproved publish rejected; invalid transition rejected; complete approved publish succeeds and sets `published_at`; sale with price period rejected; feature code format; `published → rented → published`; rental cannot be `sold` |
| Images | multiple images, ordered by `sort_order`; path must be under the property; single primary; unique position; property FK |
| WhatsApp | duplicate webhook ignored via `ON CONFLICT` (1 row stored); duplicate provider id rejected; two messages share one session; `buffered` requires a session; media references message; duplicate media id rejected; `downloaded` requires storage path; media path scoped to agency; media attachable to a property |
| Session | one open session per conversation; closed status requires `closed_at`; session references property; one property per creating session |
| Extraction | two attempts for one session with JSONB data, confidence and validation errors; `succeeded` requires data; AI output immutable for `service_role`; validation fields updatable; delete denied |
| Inquiry | references property, defaults to `new`, status updatable; invalid status rejected; contact required; submission id idempotent |
| History | events append-only for `service_role`; message with media cannot be deleted; deleting a property keeps events (link set to NULL) |
| Security (`anon`) | cannot read `whatsapp_messages`, `whatsapp_media`, `extraction_results`, `agents`, `agencies`, `submission_sessions`, `inquiries`, `automation_events`; cannot read `properties.address` or `metadata`; sees only published properties (1 of 8 in test); sees only images of published properties; view returns the published listing with 2 ordered images and correct primary image; cannot insert inquiries; cannot update properties |
| Security (`authenticated`) | cannot read `whatsapp_messages`; sees only published properties |
| Legacy booking | `viewing_slots_for_date` and `create_viewing_booking` still execute after the migration |

**Data preservation (fingerprints before vs after):** `rsvps` unchanged (1 row), the 6 legacy
`properties` rows unchanged in every original column, `viewing_schedule_rules` and `viewing_settings`
unchanged, `viewing_bookings` still 0 rows, no storage objects created.

**Advisors:**

* Security: only `rls_enabled_no_policy` (INFO) for the new private tables — intentional (private by
  default, server-side access only) — plus pre-existing findings (booking tables, Auth leaked-password
  protection disabled). No new warnings.
* Performance: no new unindexed foreign keys. New indexes show as "unused" because the tables are empty.

## 11. Repository checks

`npm run lint` and `npm run build` pass. No application code changed in this phase.

## 12. Known limitations

1. **Shared, non-dedicated project.** The schema was created in the existing project that also hosts an
   unrelated wedding RSVP app (region ap-south-1). Moving to a dedicated project remains a recommended
   decision; the migrations in this repository are the portable definition.
2. **Pre-existing migration drift** for the legacy booking migrations (local files vs. remote history,
   missing `notification_events`) is unchanged. Booking's Supabase write path would still fail; the site
   currently uses the file-based development store.
3. **`properties.agency_id` is nullable** so the six legacy rows needed no data change. It is required for
   `published`/`sold`/`rented`. Make it `NOT NULL` after the legacy rows are resolved.
4. **Slug is globally unique** (existing constraint). Per-agency slugs can be introduced later if needed.
5. **Legacy `scripts/db/sync-properties.mjs` is now incompatible**: it derives `property_type` from the
   hard-coded label (e.g. "studio / commercial"), which the new check rejects. It is inactive (no
   service-role key configured) and scheduled for deletion with the static model.
6. **New draft rows default to legacy `viewing_mode = 'standard'`**, so the legacy booking functions
   would technically treat them as bookable. The booking write path is not in use and booking will be
   removed.
7. **No agency or agent rows exist yet.** The real agency, its WhatsApp `phone_number_id` and the agent
   list must be inserted before automation runs.
8. `agency_id` consistency between child rows (e.g. image vs. its property) is not enforced by a
   composite key; writers must set it consistently.
9. No job queue table yet; retry/scheduling state is limited to session `process_after`, media
   `download_attempts`, and event logs.
10. No generated TypeScript database types: the repository has no existing type-generation convention.

## 13. Decisions deferred to later phases

* Data layer: server-side Next.js queries, caching and revalidation (Phase 2).
* Whether the six legacy rows become development fixtures, are migrated, or are archived.
* Public address precision (whether `address` / coordinates become public).
* Required-field policy beyond the current publish constraint (e.g. photo minimum).
* Price filtering across currencies.
* Exact media pipeline: when gallery images are copied from `whatsapp-media` to `property-images`,
  resizing / metadata stripping, deduplication by `sha256`.
* Session timing (quiet period, maximum duration) and command vocabulary — n8n phases.
* Job queue / dispatcher tables for n8n.
* Removal of booking tables, functions, legacy columns, and the legacy `status` column rename.
* Admin authentication model and admin RLS policies.
* Dedicated Supabase project.

## 14. Next phase

**Phase 2 — Next.js Data Layer Migration.** Not started.
