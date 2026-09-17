# Phase 3 — Remove Booking System & Repurpose Site/Admin Around Listings

Status: **complete**. Branch `phase/03-remove-booking` (from Phase 2 commit `890bb3f`).

> **Property viewing and booking are no longer part of the product.** There is no viewing reservation,
> appointment scheduler, availability calendar or booking workflow — in the website, the API, the admin
> or the database.
>
> **Supabase remains the source of truth for listings.**
>
> **n8n/WhatsApp automation has not yet been implemented.**

No secrets or environment values appear in this document.

---

## 1. Booking dependency audit

Performed before any deletion (repository-wide search for `booking`, `book`, `viewing`, `viewing_mode`,
`viewing_duration`, `viewing_availability`, `viewing_schedule`, `viewing_blackout`, `notification_events`,
`viewing-reminders`, `booking-system`, `sync-properties`, booking API paths, and imports).

**Application (closed cluster):** `lib/booking/*` → used by `components/booking/*`, `app/(site)/viewings`,
11 booking/admin API routes, 7 booking admin pages and 7 booking admin components, `lib/notifications/*`
and `lib/listings/legacy-booking.ts` (→ `PropertyDetail`, `ContactPanel`). `lib/properties.ts` was used only
by this cluster and the legacy photo installer.

**Shared pieces inside the cluster (salvaged, not deleted):**

| Piece | Shared with | Action |
| --- | --- | --- |
| `lib/booking/rate-limit.ts` | admin login route | moved to `lib/security/rate-limit.ts` |
| `lib/admin/auth.ts`, `LoginForm`, login/logout routes | admin | kept |
| `components/admin/AdminShell.tsx`, `pieces.tsx` | admin | repurposed |
| booking panel slide-in CSS | inquiry panel | renamed `.side-panel-in` |

**Database** (verified with catalog queries before the migration):

| Check | Result |
| --- | --- |
| Booking tables | `viewing_bookings` (0 rows), `viewing_availability` (0), `viewing_blackouts` (0), `viewing_schedule_rules` (6 default rules), `viewing_settings` (1 row) |
| Booking functions | `create/cancel/confirm/reschedule_viewing_booking`, `queue_viewing_reminders`, `expire_viewing_confirmations`, `viewing_open_slots`, `viewing_slots_for_date`, `viewing_setting`, `yerevan_now`, `viewing_bookings_derive`; sequence `viewing_booking_ref_seq` |
| Foreign keys | only from booking tables **to** `properties` (and `viewing_bookings` self-reference); nothing references booking tables |
| Views / policies / other functions referencing booking objects | none |
| Triggers | only `viewing_bookings_derive_trg` on `viewing_bookings`; `touch_updated_at` is also used by 8 non-booking tables |
| `notification_events` | does not exist (pre-existing drift; nothing to remove) |
| Edge Functions deployed | none |
| `pg_cron` / `pg_net` | not installed (no scheduled reminders) |
| Wedding RSVP app (`~/wedding invitation`, read-only inspection) | uses only `public.rsvps` |
| Other local projects | no references to booking objects |

## 2. Files removed

| Area | Files |
| --- | --- |
| Public booking UI | `components/booking/BookViewingButton.tsx`, `BookingPanel.tsx`, `BookingCalendar.tsx`, `ManageViewing.tsx`, `types.ts`; `app/(site)/viewings/[reference]/page.tsx` |
| Booking API | `app/api/availability/route.ts`; `app/api/bookings/route.ts`, `[reference]/route.ts`, `[reference]/cancel`, `[reference]/confirm`, `[reference]/calendar`; `app/api/cron/reminders/route.ts` |
| Booking admin API | `app/api/admin/availability`, `bookings`, `bookings/[reference]`, `notifications`, `settings` |
| Booking admin pages | `app/admin/(protected)/availability`, `bookings`, `calendar`, `customers`, `notifications`, `settings`, old `properties/page.tsx` (viewing modes) |
| Booking admin components | `AvailabilityEditor`, `BookingActions`, `BookingsBrowser`, `NotificationsPanel`, `PropertyViewingSettings`, `SettingsForm`, `ViewingCalendar` |
| Libraries | `lib/booking/*` (index, store, supabase-store, dev-store, time, types, validation, admin-queries), `lib/notifications/*` (events, telegram, dispatch), `lib/listings/legacy-booking.ts`, **`lib/properties.ts`** |
| Supabase (repo) | `supabase/functions/viewing-reminders/`; `supabase/migrations/20260912090300_cron.sql` (never applied to the database) |
| Scripts / docs | `scripts/media/install-photos.mjs`, `docs/booking-system.md` |

49 files deleted, 1 moved.

## 3. Files modified

| File | Change |
| --- | --- |
| `components/PropertyDetail.tsx` | booking actions → "Request more information"; passes display-only listing summary to the inquiry panel |
| `components/ContactPanel.tsx` | booking block → inquiry button; WhatsApp message now includes the listing reference (slug) |
| `app/(site)/properties/[slug]/page.tsx` | legacy booking bridge removed |
| `app/globals.css` | booking panel animation renamed for the side panel |
| `components/admin/AdminShell.tsx` | navigation reduced to Properties; booking store / Telegram badges → "Listings database" status |
| `components/admin/pieces.tsx` | booking pieces removed; listing status and review status pills, data notice |
| `app/admin/(protected)/layout.tsx`, `page.tsx` | booking dependencies removed; admin home redirects to properties |
| `app/admin/login/page.tsx` | "Viewing management" → "Listing management" |
| `app/api/admin/login/route.ts` | rate limiter import path |
| `lib/env.ts` | Telegram, cron and site-URL settings and the configuration report removed |
| `lib/media.ts` | legacy per-listing image helpers removed |
| `lib/supabase/admin.ts` | comment/header updated; request timeout and no-store fetch |
| `scripts/media/generate.mjs` | legacy listing placeholder and floor-plan generation removed |
| `public/media/README.md`, `README.md`, `.env.example`, `package.json` | current product, configuration and scripts |

New: `app/api/inquiries/route.ts`, `lib/inquiries/validation.ts`, `components/inquiry/InquiryButton.tsx`,
`components/inquiry/InquiryDialog.tsx`, `lib/admin/properties.ts`, `app/admin/(protected)/properties/page.tsx`,
`app/admin/(protected)/properties/[id]/page.tsx`, `lib/security/rate-limit.ts` (moved), three migrations,
this document.

## 4. APIs removed

`/api/availability`, `/api/bookings`, `/api/bookings/[reference]`, `/api/bookings/[reference]/cancel`,
`/api/bookings/[reference]/confirm`, `/api/bookings/[reference]/calendar`, `/api/cron/reminders`,
`/api/admin/availability`, `/api/admin/bookings`, `/api/admin/bookings/[reference]`,
`/api/admin/notifications`, `/api/admin/settings`. Also the page `/viewings/[reference]`.
All verified to return 404 at runtime. Database RPCs `create_viewing_booking` and `viewing_open_slots`
return 404 through the REST API.

Remaining routes: `/`, `/properties`, `/properties/[slug]`, `/admin`, `/admin/login`, `/admin/properties`,
`/admin/properties/[id]`, `/api/admin/login`, `/api/admin/logout`, `/api/inquiries`.

## 5. UI removed

"Book a viewing" buttons (detail hero and contact panel), the booking side panel (date/time selection,
availability calendar, appointment-only notice, confirmation, cancellation, calendar download), the
customer "manage your viewing" page, and every admin booking screen (dashboard, calendar, bookings,
availability, customers, notifications, booking settings, viewing modes). Navigation never linked to
booking pages, so no public links needed removal.

The detail page keeps its layout: the hero action slot and the contact panel's primary action now open
**Request more information**; phone (`tel:`), email and WhatsApp remain from `lib/site.ts`.

## 6. Admin transformation

| Screen | Content |
| --- | --- |
| `/admin` | redirects to `/admin/properties` |
| `/admin/properties` | counts per listing status (All, Draft, Published, Sold, Rented, Archived — each a filter) and a table: title, slug, status, review status, intent · type, district/city, price, created, updated |
| `/admin/properties/[id]` | read-only detail: listing fields, location (including private address/coordinates), characteristics, lifecycle (status, review, timestamps), provenance (agency, agent, source session, metadata), description, images with order and primary flag; "View on website" for published listings |

* Data access: `lib/admin/properties.ts` with the **service-role client**, server-only, only under the
  authenticated admin layout. Legacy booking columns are never selected.
* Authentication unchanged: signed HttpOnly session cookie issued against `ADMIN_PASSWORD`, checked
  server-side in `app/admin/(protected)/layout.tsx` before any page renders or queries data.
* Without `SUPABASE_SERVICE_ROLE_KEY`, the admin shows a "Not configured" notice and no data.
* Not built (by design): editing, review workflow, bulk actions, inquiries screen.

## 7. Inquiry implementation

```text
Listing page → "Request more information" (client panel: name, phone, email optional, message)
  → POST /api/inquiries (Next.js server)
      in-memory rate limit 5/min per IP · body ≤ 10 KB · honeypot field · validation
  → Supabase RPC submit_inquiry (publishable key, role anon)
      re-validation · resolves the listing SLUG only if listing_status = 'published'
      agency_id taken from the listing · idempotent per submission id · flood guard
  → private table public.inquiries (source = 'website', status = 'new')
```

* **Required:** name (2–120), phone (7–15 digits; `+`, spaces, `().-` allowed). **Optional:** email
  (validated, stored lowercase), message (≤ 2000; prefilled "I'd like more information about …").
  The listing is taken from the page, never chosen by the visitor.
* **No arbitrary property ids:** the API accepts a slug; the database resolves it only for a published
  listing. Drafts, sold, rented, archived, unknown slugs and ids return `property_unavailable` (HTTP 409).
* **Duplicate protection:** the form creates a submission id when it opens; retries/double submits with the
  same id create one inquiry (existing partial unique index `(agency_id, client_submission_id)`). A new id
  is issued after each successful request, so repeat contact later is allowed. Additionally, a phone number
  can create at most 3 inquiries for the same listing within 10 minutes.
* **Why an RPC:** `inquiries` has no public privileges or policies. `submit_inquiry` is
  `SECURITY DEFINER` with a pinned `search_path`, performs one validated insert and returns only
  `{ok, error | duplicate}` — no ids, rows or database errors. It is executable by `anon` (the website's
  server-side role) and `service_role` only. This avoids giving the public site the service-role key.
* **Errors:** database or configuration failures return HTTP 503 with a generic message; internal errors are
  only logged (code only).

Supabase advisor note: `anon_security_definer_function_executable` (WARN) for `submit_inquiry` is
**intentional** — it is the validated public write path described above. The `authenticated` grant was
removed (`20260917164739_inquiry_submission_least_privilege`).

## 8. `lib/properties.ts` result

**Deleted.** Repository-wide search shows no remaining code import of `lib/properties`, `PROPERTIES`,
`bySlug`, `featuredProperty` or `filterProperties`. The public site and admin read listings only from
Supabase.

## 9. Legacy media result

* `lib/media.ts`: `floorPlan`, `REAL_PHOTOGRAPHY` and `propertyMedia` removed (their only consumer was
  `lib/properties.ts`). Brand media paths remain.
* `scripts/media/install-photos.mjs` and the `media:photos` npm script removed (it parsed
  `lib/properties.ts`).
* `scripts/media/generate.mjs` no longer generates listing placeholder photos or the placeholder floor plan.
* **Kept on disk (not deleted):** `public/media/properties/*` (legacy demo listing photos and floor plan)
  and the `propertyPhotos` record in `public/media/installed.json`. Nothing references them; they are
  retained temporarily for rollback/reference.

## 10. Environment cleanup

| Variable | Result |
| --- | --- |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | removed (only booking notifications used them) |
| `CRON_SECRET` | removed (only the reminder cron route) |
| `NEXT_PUBLIC_SITE_URL` | removed from `.env.example` and `lib/env.ts` (only booking reminder links and the booking configuration report used it) |
| `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` | kept — public listing reads and inquiries |
| `SUPABASE_SERVICE_ROLE_KEY` | kept — now admin listing management only, server-only |
| `ADMIN_PASSWORD`, `ADMIN_SESSION_SECRET` | kept — documented that deployment requires a strong password and a random 32+ character secret |

`.env.local` was not modified (it may still contain the removed variable names; they are ignored).

## 11. Supabase booking objects — removed / retained

**A — Removed safely** (migration `20260917141010_remove_booking_system`, no CASCADE, guarded):

| Object | Kind |
| --- | --- |
| `viewing_bookings`, `viewing_availability`, `viewing_blackouts`, `viewing_schedule_rules`, `viewing_settings` | tables (with their indexes, constraints, FKs to `properties` and trigger) |
| `create_viewing_booking`, `cancel_viewing_booking`, `confirm_viewing_booking`, `reschedule_viewing_booking`, `queue_viewing_reminders`, `expire_viewing_confirmations`, `viewing_open_slots`, `viewing_slots_for_date`, `viewing_setting`, `yerevan_now`, `viewing_bookings_derive` | functions |
| `viewing_booking_ref_seq` | sequence |

The migration first aborts if any booking or availability rows exist, if `rsvps` is missing, or if a view
depends on a booking table. Data removed: the booking system's own defaults only — 6 schedule rules
(Mon–Fri 10:00–19:00, Sat 11:00–16:00, 90-minute slots, agency-wide) and 1 settings row (timezone
Asia/Yerevan, max 60 days ahead, 180-minute lead time, 90-minute slots, 24-hour reminders, no auto-cancel).
No customer data existed.

**B — Application-dead but database-retained:**

| Object | Why retained |
| --- | --- |
| `properties.status`, `properties.location`, `properties.viewing_mode`, `properties.viewing_duration_minutes`, `properties.images` | columns of the live listings table; dropping them would alter the six legacy rows. No application code reads them; column comments mark them "LEGACY, unused, candidate for removal". |
| Remote migration history rows for the old booking migrations | history records; left untouched |
| Local migration files `20260912090000/090100/090200/091000` | they create `public.properties`, which later migrations extend; kept so the repository history stays replayable in order (note: the local booking files never matched the remote history exactly — pre-existing drift) |

**C — Still required:**

| Object | Dependency |
| --- | --- |
| `touch_updated_at()` | `updated_at` triggers on `agencies`, `agents`, `inquiries`, `properties`, `property_images`, `submission_sessions`, `whatsapp_media`, `whatsapp_messages` |

## 12. Database safety verification

Before and after the migrations (fingerprints computed over full row contents):

| Check | Result |
| --- | --- |
| Wedding `rsvps` (1 row) | unchanged |
| Six legacy `properties` rows, every original column | unchanged; still `listing_status = draft` |
| `inquiries` table | exists; private (anon REST read and insert → 401) |
| `published_property_listings` view | exists; anon read works; drafts excluded |
| `property_images` schema and public read policy | intact (images of published listings readable, others not) |
| RLS | enabled on every public table; 5 policies (3 RSVP, 2 public listing reads) |
| Booking objects remaining | 0 relations, 0 functions |
| Storage | no objects |
| Temporary test data | removed and verified (0 test agencies/properties/images/inquiries) |

## 13. Tests

Environment: local production build + `next start`, connected Supabase project, publishable key supplied to
the test process only (scratch file, deleted afterwards). Temporary test data: one test agency, two
published listings (one featured, two images), one draft (`zz-phase3-*`, `metadata.test = phase3`),
removed afterwards.

| # | Test | Result |
| --- | --- | --- |
| 1 | Property index loads | PASS |
| 2 | Property detail loads | PASS |
| 3 | Published listings appear | PASS |
| 4 | Drafts hidden (index; detail 404) | PASS |
| 5 | Filters (intent; type + district; price + bedrooms) | PASS |
| 6 | Featured listing on homepage | PASS |
| 7 | Images structurally present (Storage URLs, alt text) | PASS |
| 8–10 | No booking / viewing / availability UI or links on home, index, two detail pages | PASS |
| 11 | Request-information actions render; panel opens (browser) | PASS |
| 12 | Valid inquiry → 201, stored once with correct listing/agency/source; retry with same submission id → 201, no duplicate; browser submission → confirmation state | PASS |
| 13 | Invalid email → 400 with email field error | PASS |
| 14 | Invalid phone → 400 with phone field error; empty form shows client-side errors (browser) | PASS |
| 15 | Draft listing and legacy draft listing cannot receive inquiries (409) | PASS |
| 16 | Property id instead of slug, unknown slug → 409; missing submission id → 400; honeypot → 201 with no row | PASS |
| 17 | Malformed JSON, oversized body, long message → 400 generic; GET → 405; Supabase unavailable → 503 generic message, no internal detail; rate limit → 429 generic | PASS |
| 18 | Anonymous `/admin`, `/admin/properties`, `/admin/properties/[id]` → redirect to sign-in, no data | PASS |
| 19 | Authenticated admin: sign-in (200), `/admin` → `/admin/properties`, properties page renders (200) | PASS |
| 19–22 (data) | **Admin listing data, status, review state and images with real rows: NOT EXECUTED** — `SUPABASE_SERVICE_ROLE_KEY` is not configured locally and cannot be obtained through the available tooling; the page correctly showed the "Not configured" notice and no data. The query code is type-checked; the underlying columns/values were verified in SQL. |
| 23 | No booking management in admin (navigation and content) | PASS |
| 24–30 | Repository: no active imports of `lib/properties`, booking modules, booking API paths, booking navigation, "Book a Viewing", `viewing_mode`/`viewing_duration_minutes` application use, or `sync-properties` | PASS |
| — | Removed routes: 14 former booking/admin paths return 404 (GET and POST) | PASS |
| — | Database (transaction, rolled back): anon RPC valid/duplicate/distinct submissions, draft/legacy/unknown/uuid rejections, email/phone/name/message validation, flood guard (3 allowed, 4th rejected, other phone allowed), anon cannot read or insert `inquiries`, published read model intact, email stored lowercase | PASS |
| — | Direct REST with publishable key: `inquiries` read/insert denied; `submit_inquiry` on a draft returns only `property_unavailable` | PASS |

Test-harness notes (not product failures): the first run sent more than 5 inquiry requests per minute and
received 429 from the route limiter; those checks were re-run within the limit and passed, and the limiter
itself was tested explicitly. One database test initially miscounted the flood-guard threshold; re-run with
the correct expectation and passed. The authenticated admin check signed in over HTTP to the local test
server with the configured local admin password (read from `.env.local` inside the test script, never
printed); the password was not typed into a browser.

`npx tsc --noEmit`: clean. `npm run lint`: 0 errors. `npm run build`: success, 12 routes, none booking-related.

## 14. Visual verification

Checked in the in-app browser (phone width, and a desktop-width layout measurement):

* **Detail page:** hero keeps its layout with "Request more information" in the former booking slot;
  contact panel shows price, request action with helper text, agent block, phone, email and WhatsApp — no
  empty space or dead buttons; no horizontal overflow; two-column grid with sticky panel on desktop.
* **Inquiry panel:** opens full-screen on a phone in the existing panel style; client-side field errors
  display correctly; successful submission shows the confirmation state; close works.
* **Properties index:** result cards render normally (image, position/type, title, location, description,
  facts, price, link).
* **Admin sign-in:** "Listing management" label, unchanged styling.
* **Not visually checked:** the authenticated admin properties screens with data (service-role key not
  configured; see test 19–22). Test listings had no uploaded image files, so browsers showed broken-image
  placeholders for those test rows only.

## 15. Known limitations

1. **Admin needs `SUPABASE_SERVICE_ROLE_KEY`** locally/in deployment to show listings; not configured in
   `.env.local`, so admin data rendering is untested with real rows.
2. **Admin authentication is a single shared password** (signed cookie). Adequate for one operator; the local
   password is weak and must be replaced with a strong one before deployment. Per-user accounts are a later
   improvement.
3. **Inquiries are stored but no one is notified** and there is no admin inquiries screen yet; they are
   visible in the Supabase dashboard only.
4. The route rate limiter is in-memory (per server instance); the database flood guard is per phone and
   listing. No CAPTCHA.
5. **Sold and rented listings are not publicly visible**: the Phase 1 RLS policy and view expose only
   `published`. Whether sold/rented should be shown with a badge is not established by requirements —
   left as is.
6. Contact details (phone, WhatsApp, email, agent name) are still the placeholders in `lib/site.ts`; per-agent
   contacts are not used yet.
7. Admin is read-only (no editing, publishing or review actions).

## 16. Remaining legacy cleanup

* Drop legacy `properties` columns `status`, `location`, `viewing_mode`, `viewing_duration_minutes`,
  `images` once the six legacy rows are resolved (migrated, archived or removed).
* Decide the fate of the six legacy draft listings and `public/media/properties/*` photos.
* The local booking-era migration files and the remote migration history still differ (pre-existing);
  consider a fresh baseline when moving to a dedicated Supabase project.
* Historical phase documents (Phase 0–2) intentionally still describe the booking system as it was.

## 17. Next phase

**Phase 4 — WhatsApp/n8n Automation Foundation.** Not started.
