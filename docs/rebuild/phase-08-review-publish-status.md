# Phase 8 — Listing Review, Publication and Status Management

Status: **complete, with limitations** (admin UI against live data and WhatsApp end-to-end need credentials that are
not present locally — see §13). Branch `phase/08-review-publish-status` (from Phase 7 commit `3f4303f`).

> Drafts produced by the WhatsApp pipeline can now be reviewed with their full provenance, approved or rejected with a
> reason, published through one database path, and moved through sold / rented / archived — by an admin, or by the
> owning agent with an exact WhatsApp command. The database is the only authority; no AI decides anything here.
> Booking stays removed; the old WhatsApp group is still not an ingestion channel; no historical import.

No secrets, tokens or credential values appear in this document or in the repository.

---

## 1. What existed (read first)

| Area | Before Phase 8 |
| --- | --- |
| `properties` | `listing_status` (draft/published/sold/rented/archived) guarded by `properties_listing_lifecycle` (allowed transitions), `review_status` (pending/approved/rejected), `properties_publishable` (published ⇒ approved + title/intent/type/city/price/currency), `properties_sold_is_sale`, `properties_rented_is_rent`, `properties_agency_required`; RLS: public reads only `published` |
| Drafts | created by `generate_property_draft` (Phase 6): `draft` / `pending` / `whatsapp`, linked to session and extraction |
| Media | Phase 7 pipeline; photos attach only while the listing is a draft |
| Admin | read-only list + detail (service role); thumbnails from **public** Storage URLs |
| WhatsApp commands | `done`/`finish`, `cancel` (session commands) only |
| Outbound WhatsApp | none (no send node, no credential) |

## 2. Schema changes

Migrations `20260919164043_review_publish_status.sql`, `20260919164215_whatsapp_status_commands.sql` (local copies
identical to the applied statements).

- `properties` + `review_note` (rejection reason, 3–500 chars, required when `rejected`), `reviewed_at`, `reviewed_by`
  (admin session reference), `state_version` (incremented by a trigger on **every** update). All private (no anon grants).
- `whatsapp_messages.command` may now also be `status_sold`, `status_rented`, `status_archived`.
- Functions (all `SECURITY INVOKER`, fixed `search_path`, `EXECUTE` for `service_role` only):
  `property_publication_check`, `admin_review_property`, `admin_publish_property`, `admin_set_listing_status`,
  `whatsapp_status_command` (parser), `apply_whatsapp_status_command`, helpers `property_event`, `admin_actor`,
  trigger `properties_state_version`.
- `ingest_whatsapp_message` recognises status commands (three insertions; everything else unchanged).
- Views (`security_invoker`, `SELECT` for `service_role` only): `admin_property_review`, `admin_media_issues`,
  `admin_submission_issues`.

No tables dropped or renamed, no RLS policy changed, no bucket or Storage policy changed.

## 3. Admin review architecture

```
/admin/properties            review queue  ── admin_property_review (service role)
/admin/properties/[id]       review detail ── view + extraction_results + source messages + media + property_images + automation_events
/admin/pipeline              held / rejected / failed / expired media, incomplete / conflicting / failed submissions
server actions (lib/admin/actions.ts) ── one RPC each: admin_review_property | admin_publish_property | admin_set_listing_status | request_media_reprocessing
/api/admin/images/{property|media}/{id}   authenticated image route (§6)
```

- Every page is under the existing server-side admin gate (signed HttpOnly cookie); every server action re-checks the
  session; the service-role client exists only on the server.
- Queue tabs: *Pending review* (draft + pending/none), *Draft · approved*, *Draft · rejected*, *Published*, *Sold*,
  *Rented*, *Archived*, *All* — no new lifecycle states.
- Queue columns: title/slug, listing + review status, intent · type, price, location, agent · agency, extraction status
  and conflicts, photo count + processing/problem counts, publishability (first blocker, all blockers on hover).
- Detail: publication check (blockers/warnings from the database), listing fields, extraction (attempt, model, prompt
  version, validation result, issues, conflicts, notes, every non-unknown field with value, status, supporting message
  numbers and verbatim evidence), the numbered source messages, per-photo media state, the listing's audit trail,
  review info, ownership (agent, agency, submission session). Not shown: raw payloads, phone numbers, BSUIDs.
- Legacy rows (no agency) are shown but cannot be reviewed or published (database refuses; UI says so).

## 4. Review decisions

`admin_review_property(id, 'approve' | 'reject', reason, expected_version, actor)`:
only drafts with an agency; reject needs a 3–500 character reason (stored as `review_note`); approve clears it.
Approval never publishes. Outcomes: `approved` / `rejected`, `already` (repeat of a completed decision — double click),
`stale` (version changed since the page was rendered), `invalid_state`, `not_reviewable`, `invalid_request`.
Audit: `property.review_approved` / `property.review_rejected` (actor, from, to, reason).

## 5. Publish flow

`property_publication_check(id)` is the single rule set (the UI displays it, publication enforces it):

| Blocker | Rule |
| --- | --- |
| `already_published`, `archived` | lifecycle state |
| `no_agency`, `agency_missing` | ownership |
| `agent_agency_mismatch`, `agent_inactive` | the listing's agent must be active and in the listing's agency |
| `not_approved` | review status must be `approved` |
| `missing_title/intent/property_type/city/price/currency` | required fields (same as `properties_publishable`) |
| `extraction_not_valid`, `unresolved_conflict` | WhatsApp listings: latest linked extraction succeeded + valid, every conflict resolved by a later correction |
| `media_processing` | WhatsApp listings: photos still on their way (they can only attach while the listing is a draft) |
| warnings | `no_images`, `newer_extraction_not_applied` (never blocking) |

`admin_publish_property(id, expected_version, actor)`: row lock → `already` if published → stale check → rule set →
`listing_status = 'published'` (the lifecycle trigger validates the transition and sets `published_at`;
`properties_publishable` re-checks). Same row: no copy, slug unchanged, ownership and provenance untouched.
Relisting sold/rented listings uses the same path. Audit: `property.published` / `property.publish_blocked`.
The website reads `published_property_listings` per request, so a published listing is live immediately (tested
against a production build, no rebuild/restart).

## 6. Image access for review

Admin thumbnails no longer use public Storage URLs. `/api/admin/images/property/<property_images.id>` and
`/api/admin/images/media/<whatsapp_media.id>`:
admin session required (401 otherwise) → object looked up **by id** in the database (never a caller path) → downloaded
server-side with the service role → returned with the validated image type only, `Cache-Control: private, no-store`,
`nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`. WhatsApp originals are previewable only after
validation (rejected/unvalidated bytes are never served). Published images stay public (intended website behaviour).

**Residual, unchanged and documented:** gallery copies of drafts still live in the public-object bucket
`property-images` at unguessable, undisclosed paths (Phase 7 §13). The admin no longer depends on that; eliminating it
requires keeping draft copies in a private bucket and copying them at publication — a Storage redesign deliberately
left out of this phase.

## 7. Failure visibility (`/admin/pipeline`)

Held media (with the hold reason), rejected media (validation code), failed media (stage, attempts), expired media, and
submissions that are incomplete, conflicting, invalid or failed (with validation issues). The only action exposed is
**Retry** for `failed` media, which calls the existing `request_media_reprocessing` (resets that stage's attempt
budget, refuses anything not `failed`, refuses expired media, writes `media.requeued` with the admin reference) after a
confirmation. Session reprocessing is deliberately not exposed.

## 8. WhatsApp status commands

Syntax (one message, case-insensitive, no AI, no fuzzy matching):

```
sold    <reference>      also: продано, продана, վաճառված
rented  <reference>      also: сдано, сдана, վարձակալված
archive <reference>      also: remove, архив, убрать, արխիվ
<reference> = the exact listing slug, or the listing link …/properties/<slug>
```

Parsing (`whatsapp_status_command`): the keyword plus at most two more tokens (longer text is ordinary listing
content); surrounding `<>()"'` and trailing punctuation are ignored; the reference is lower-cased and must be an exact
slug or a URL whose path is exactly `/properties/<slug>`. No reference → `missing_reference`; two → `ambiguous_reference`;
anything else → `invalid_reference`.

Where: inside `ingest_whatsapp_message`, only for a **resolved, active agent** in a **direct** conversation and a text
message; session commands (`done`/`cancel`) take precedence; a status command never joins or changes a submission
session. Unknown senders, inactive agents, groups and other message types never reach it.

Authorization (`apply_whatsapp_status_command`, row-locked): the listing must have **exactly** that slug, belong to the
**sending agent** and the **sender's agency**. Another agent's or agency's listing, and a non-existent reference, get the
**same** reply ("no listing of yours matches that reference"); the internal event distinguishes `not_found` /
`not_permitted` for the admin only.

## 9. State transition rules

| Action | Allowed from | Guard |
| --- | --- | --- |
| admin publish / relist | draft (approved), sold, rented | full publication check |
| admin / WhatsApp `sold` | published | intent `buy` |
| admin / WhatsApp `rented` | published | intent `rent` |
| WhatsApp `archive` | published, sold, rented | — |
| admin `archive` | draft, published, sold, rented | — |
| admin unpublish (`draft`) | published | — |
| admin restore (`draft`) | archived | — |

Everything else is refused (`invalid_transition`), and the existing lifecycle trigger remains the final guard. Nothing
is ever deleted; images, extraction and session links are kept. Sold/rented/archived listings leave
`published_property_listings` (existing read model: published only) and their pages return 404.

## 10. Idempotency and concurrency

- Admin: repeating a completed action returns `already` with the current state; actions carry `state_version`, so an
  action rendered before any other change (admin or WhatsApp) returns `stale` instead of overwriting.
- WhatsApp: a redelivered message is a duplicate and is never re-applied (Phase 4 message idempotency); a new message
  asking for the current status returns `already` (`property.status_command_duplicate`).
- All mutations lock the property row (`FOR UPDATE`), so concurrent actions serialize; the second sees the first's
  result (`already`, `stale` or `invalid_transition`).
- Buttons disable while a request is pending; the server outcome is authoritative anyway.

## 11. Audit events (`automation_events`, property-linked)

`property.review_approved`, `property.review_rejected`, `property.published`, `property.publish_blocked`,
`property.status_changed` (`actor_kind` admin | whatsapp_agent, actor/agent, from, to, reason),
`property.status_command_rejected` (action, reference, reason, reply text), `property.status_command_duplicate`,
`media.requeued` (admin retry). Admin actor = `admin:<12-hex one-way hash of the session cookie>`.

## 12. WhatsApp replies

No outbound WhatsApp exists yet (no send node, no WhatsApp Cloud API credential). Replies are **computed and recorded**
(`reply_text` in the event and in the ingestion response `status_command.reply_text`) but **not sent**. No reply was
faked. Sending requires a later phase with the `whatsAppApi` credential and a send step in n8n.

## 13. Tests

**Live database (zz-phase8-test fixtures through the real pipeline: ingestion → session → extraction → draft)** — all PASS:

| # | Test | Result |
| --- | --- | --- |
| A | draft appears in review queue with agent, agency, extraction, media and blockers | PASS (5 drafts) |
| B | provenance: extraction fields with evidence, source messages, session, attempt | PASS |
| C | approve succeeds once | PASS |
| D | repeated approve (old version) → `already` | PASS |
| E | reject requires and stores a reason | PASS (`reason_required`, then stored) |
| F | rejected draft cannot publish | PASS (`not_approved`) |
| G | approved but invalid draft cannot publish | PASS (`agent_inactive`; also `media_processing`) |
| H | valid approved draft publishes | PASS (after its pending photo was resolved) |
| I | repeated publish → `already`; exactly one `property.published` event | PASS |
| J | published listing appears publicly without rebuild | PASS (production build, 200 + in listing view) |
| K | admin image route without session / with forged cookie | PASS (401 / 401) |
| L/M | cross-agent / cross-agency ownership blocks publish | PASS (`agent_agency_mismatch`) |
| N | `sold <slug>` changes only that listing | PASS |
| O | `rented <listing URL>` | PASS |
| P | `archive <slug>` archives (row, session and extraction links kept) | PASS |
| Q | invalid transitions (sold on a rental, rented on a sold listing, archive a draft) | PASS (nothing changed) |
| R | unknown reference | PASS (nothing changed) |
| S | ambiguous reference | PASS (nothing changed) |
| T | other agent / other agency / unknown sender | PASS (same reply as unknown; unknown sender never reaches commands) |
| U | duplicate webhook of a command | PASS (duplicate, no second change/event) |
| V | stale admin action after a WhatsApp change | PASS (`stale`); true parallel sessions not executable here (row locks) |
| W | public regression | PASS (below) |
| X | RSVP data unchanged | PASS (`090be351…`) |
| Y | legacy properties unchanged | PASS (original-column fingerprint `dd176f32…`, `state_version` 1, last update 2026-09-12) |
| Z | no booking functionality | PASS (`/book`, `/viewings`, `/api/bookings` 404; no booking text) |

Also: stale approve refused; legacy rows refused by review/publish; `sold` on a draft refused; commands never created
or changed a session; `done` still works. Parser regression: `supabase/tests/whatsapp_status_command.test.sql`
(22 cases, PASS).

**Public regression (production build, publishable key, live project)**: drafts / rejected / archived / legacy → 404;
published pages 200 with Call (`tel:`) and WhatsApp links and no internal ids (session, extraction, message, media,
agent, agency ids, BSUIDs, review fields); sold/rented/archived removed from the listing and 404 immediately; listing
pages work with zero listings; Request More Information → 201 for a published listing, 409 for a draft. Anonymous
REST: admin views, `review_note`, admin functions and `PATCH properties` → 401; published view only.

**Existing tests**: `npm run test:media` 11/11 PASS. TypeScript, ESLint, production build: PASS.

**Not tested live** (see §14): the admin UI against live data (no `SUPABASE_SERVICE_ROLE_KEY` locally — the pages were
built and type-checked, unauthenticated access verified; the actions call the same functions tested above), admin
sign-in with the real password (not entered), WhatsApp end-to-end.

Cleanup: all zz-phase8-test agencies, agents, messages, media, sessions, extraction results, properties, inquiries and
events deleted; counts 0; legacy and RSVP fingerprints unchanged.

## 14. Blocked by missing credentials

- **Admin UI against live data:** needs `SUPABASE_SERVICE_ROLE_KEY` in the server environment. Verify: sign in → queue
  → open a draft → approve → publish → view on website.
- **WhatsApp end-to-end:** Meta credentials (Phase 4/6.5/7) for real inbound status commands; the ingestion path was
  tested with normalized events in the database.
- **Outbound replies:** not implemented (§12).

## 15. Security considerations

Service role only on the server (`lib/supabase/admin.ts`, `server-only`); no browser-side privileged client; server
actions validate ids/enums/lengths and trust nothing else from the form; the database re-checks ownership,
transitions, publication rules and versions; no hidden-field authorization; no new public routes for internal entities
(the image route requires the admin session); WhatsApp errors never reveal other listings; all new functions and views
are service-role only with fixed `search_path`; Supabase advisors report no new findings.

## 16. Updates are not automatic (extension point)

Phase 6 is create-only and stays that way: a later extraction for a session that already has a listing is recorded
(`property.update_rejected`, warning `newer_extraction_not_applied`) but never merged. A future, explicit update flow
should (1) name the listing exactly (same reference rules as status commands), (2) produce a field-level diff for
admin review, and (3) apply only approved fields through a dedicated database function. Not implemented.

## 17. Rollback

```sql
-- restore ingestion from Phase 6.5 (re-run the function in 20260918092512), then:
drop view public.admin_property_review, public.admin_media_issues, public.admin_submission_issues;
drop function public.apply_whatsapp_status_command(uuid, uuid, uuid, jsonb, text), public.whatsapp_status_command(text),
  public.admin_set_listing_status(uuid, text, integer, text, text), public.admin_publish_property(uuid, integer, text),
  public.admin_review_property(uuid, text, text, integer, text), public.property_publication_check(uuid),
  public.admin_actor(text), public.property_event(public.properties, text, text, text, text, jsonb, uuid);
drop trigger properties_state_version_trg on public.properties;
drop function public.properties_state_version();
alter table public.whatsapp_messages drop constraint whatsapp_messages_command_check,
  add constraint whatsapp_messages_command_check check (command in ('finish', 'cancel'));  -- after clearing status_* rows
alter table public.properties drop column review_note, drop column reviewed_at, drop column reviewed_by,
  drop column state_version;  -- (drops the review/version constraints with them)
```
Revert the admin pages, `lib/admin/*`, the image route and `components/admin/ReviewActions.tsx` from Git.

## 18. Known limitations

- Single shared admin password (existing model): reviewer identity is a session reference, not a person.
- No listing editing in the admin (fields come from WhatsApp; corrections = reject with a reason, agent resends).
- Draft gallery copies remain reachable at their exact public URL (§6).
- Status command replies are not delivered (§12).
- Parallel-connection races verified by design (row locks + versions), not by a parallel test.
