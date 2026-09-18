# Phase 6 — Property Draft Generation

Status: **complete**. Branch `phase/06-property-draft-generation` (from Phase 5 commit `1f04de8`).

> Valid extraction result → deterministic, atomic, idempotent creation of **one** `properties` row that is
> **not public**: `listing_status = draft`, `review_status = pending`, `source = whatsapp`.
> Nothing in Phase 6 publishes, approves, creates images, or updates an existing property.

No secrets, tokens or credential values appear in this document or in the repository.

---

## 1. Existing architecture (inspected first)

| Object | What was already there | Phase 6 use |
| --- | --- | --- |
| `properties` | `listing_status` (draft/published/sold/rented/archived, default draft), `review_status` (pending/approved/rejected), `agency_id`, `agent_id`, `source` (whatsapp/admin/import/seed), `created_from_session_id` **unique**, private `metadata`/`address`, lifecycle trigger, `properties_publishable` check (published ⇒ approved + complete) | the draft record |
| `published_property_listings` | `security_invoker` view, `WHERE listing_status = 'published'`; RLS policy `properties_public_read_published` | unchanged — the public guarantee |
| `submission_sessions` | `property_id`, `kind`, Phase 5 state machine | linked to the draft; `completed → needs_review` edge added |
| `extraction_results` | append-only; `property_id` is the one column `service_role` may update | linked to the draft |
| `agencies`, `agents` | session → agent (FK) → agency | ownership |
| `automation_events` | append-only trail | `property.*` events |
| n8n *Submission Extraction* | advance → claim → AI → record | extended (section 11); *WhatsApp Inbound* and *Property Extraction (AI)* unchanged |

The six legacy rows (`atelier-loft`, `cascade-house`, `hillside-land`, `modern-residence`, `north-avenue-flat`,
`panorama-penthouse`) are `draft`, no agency, no session. They are never read, matched or modified by Phase 6.

## 2. Lifecycle and review

The existing lifecycle fields are used; there is no second lifecycle.

- An automated property is **always inserted** with `listing_status = 'draft'`, `review_status = 'pending'`,
  `source = 'whatsapp'`, `published_at = null`, `featured = false`, and `created_from_session_id` set.
- *Automation-created* = `created_from_session_id is not null` (+ `source = 'whatsapp'`,
  `metadata.automation.generator = 'property-draft-v1'`). *Review required* = `review_status = 'pending'`
  (+ `metadata.automation.review_required = true`).
- Defence in depth: trigger `properties_automation_insert_guard_trg` rejects any INSERT with a
  `created_from_session_id` unless it is draft / pending / whatsapp / unpublished (tested: published+approved,
  draft+approved, draft+no review status → all rejected).
- The generator's code contains no `published`, `approved` or `property_images` reference (verified by catalog
  query). Publishing still requires `review_status = 'approved'` by the existing `properties_publishable` check — a
  human step for a later phase.
- Public visibility is decided only by `listing_status = 'published'` (view + RLS), which Phase 6 never sets.

## 3. Create vs update — CREATE-ONLY

Phase 6 implements **create only**. Update is **deferred**.

- Every valid extraction of a **new** session creates a new draft. There is **no fuzzy matching**: similar text,
  same agent, same district or same price never selects an existing property (tested: the same agent re-sending the
  same listing in a new session produced a second draft `…-2`; the first draft was byte-identical afterwards).
- A valid extraction for a session that **already has a draft** (e.g. an explicit reprocess after a correction) is
  rejected as `update_not_supported`: event `property.update_rejected`, session → `needs_review`
  (`last_error = property_update_not_supported`), existing draft unchanged (verified by md5).
- AI output can never name a property id; there is no code path that takes one.
- Rationale: identifying "the same property" needs an explicit reference the agent can quote (e.g. the listing slug or
  a short code in WhatsApp) and a reviewed update policy (which fields may change, price history, status commands).
  Until then duplicates are safer than wrong overwrites; reviewers can archive a duplicate draft.

## 4. Eligibility (all verified inside the database, never by n8n)

`generate_property_draft(extraction_result_id)` rejects unless **all** hold:

1. the extraction result exists, `status = 'succeeded'` and `validation_status = 'valid'` (not incomplete, conflicting,
   invalid, failed or invalid_output);
2. its session is `completed` (not open/ready/processing/needs_review/cancelled/failed);
3. it is the **current** attempt: no newer extraction result exists for the session (stale attempts rejected);
4. neither the extraction nor the session is already linked to a property;
5. provenance is consistent: `extracted_data.source.session_id` = the session, agency ids match;
6. ownership (section 6) holds;
7. the trusted `extracted_data.property` has intent, property type, city, price and currency.

Rejections return `{ok:false, outcome:'rejected', reason}` and write `property.generation_rejected` (or
`property.ownership_failed`). Invalid/incomplete/conflicting sessions are already `needs_review` from Phase 5.

## 5. Field mapping (`extracted_data.property` → `properties`)

Only the **trusted** property values produced by Phase 5 validation are read (uncertain, conflicting, unsupported or
removed values are never in `extracted_data.property`). Unknown stays `NULL`; nothing is invented.

| Extraction field | Column | Rule |
| --- | --- | --- |
| title | `title` | title policy (section 7) |
| description | `description` | as validated (agent's own text) |
| intent | `intent` | `buy` / `rent` |
| property_type | `property_type` | enum |
| country | `country` | ISO-2, only if validated (guards remove inferred `AM`) |
| city, district | `city`, `district` | as validated |
| address | `address` | private column (not in the public view) |
| latitude, longitude | `latitude`, `longitude` | numeric; pairs enforced by constraint; not in the public view |
| price, currency | `price`, `currency` | numeric / enum |
| price_negotiable | `price_negotiable` | boolean |
| price_period | `price_period` | kept **only for rent**; always `NULL` for sales |
| area_sqm, land_area_sqm | same | numeric |
| rooms, bedrooms, bathrooms, floor, total_floors, year_built | same | smallint |
| features | `features` | text[] in the validated order |
| — | `slug` | section 8 |
| — | `listing_status`, `review_status`, `source` | constants `draft`, `pending`, `whatsapp` |
| — | `agency_id`, `agent_id`, `created_from_session_id` | from the session (section 6) |
| — | `metadata.automation` | `generator`, `review_required`, `extraction_result_id`, `extraction_attempt_id`, `prompt_version`, `model`, `title_source` |

Legacy booking columns (`status`, `viewing_mode`, `viewing_duration_minutes`, `images`, `location`) take their
existing defaults / `NULL`. No raw WhatsApp payload or message text (other than the validated description) is copied
into `properties`.

## 6. Ownership

`session.agent_id → agents` (must exist, `is_active`, `agents.agency_id = session.agency_id`) `→ agencies` (must exist).
Ownership values come only from these rows — never from AI output. The session's agent was itself resolved in Phase 4
from the sender's phone number within the agency that owns the receiving business number; unknown senders never get a
session (tested: 0 sessions, 0 extractions, 0 properties).

If the check fails (agent deactivated or moved to another agency after the submission): no property, event
`property.ownership_failed` (reason `agent_inactive` / `agency_mismatch` / `agent_missing`), session → `needs_review`
(`last_error = property_ownership_failed`) so it leaves the automatic queue and needs routing attention. No agency or
agent is ever created.

## 7. Title policy

1. **Deterministic title** (`property_draft_title`), always computed from validated fields:
   `[<N>-bedroom | <N>-room | <area> m² ]<type> for sale|rent in [<district>, ]<city>`
   — bedrooms preferred over rooms (not for land/garage/warehouse); land uses land area; commercial/office/retail/
   warehouse/garage use area; `commercial` → "commercial space", `retail` → "retail space", `other` → "property";
   first letter capitalised; ≤ 160 characters.
   Examples: "3-room apartment for sale in Kentron, Yerevan", "4-bedroom house for rent in Dilijan",
   "2,000 m² land for sale in Abovyan", "120.5 m² commercial space for rent in Nor Nork, Yerevan".
2. **AI title** is used only if `property_title_supported` accepts it: it must name the property type and **every word**
   must be a connector (a, an, the, in, at, on, with, and, of, near, for), a unit word (room(s), bedroom(s),
   bathroom(s), sqm, m², floor, storey), the validated type, intent word (sale/sell for buy; rent/rental/lease for rent),
   city, district or feature words, or a **validated number**.
   Rejected examples (tested): "Luxury 3-room apartment in Kentron" (luxury), "4-room apartment…" (wrong number),
   "…for rent…" on a sale, "3-room flat in Kentron" (type not named), "Kentron, Yerevan" (no type).
3. Otherwise the deterministic title is used. `metadata.automation.title_source` records `ai_validated`, `generated`
   (no AI title) or `generated_ai_rejected`.

The site had no generated-title convention (legacy titles are hand-written names); the format matches the prompt's own
example style and can be restyled in review.

## 8. Slug

- Base = `property_slug_base(deterministic title)`: lowercase, `m²` → `m2`, digit-group commas removed, every run of
  non `[a-z0-9]` → `-`, trimmed, ≤ 80 chars, fallback `property`. It derives from the **deterministic** title, so AI
  wording never changes it. Example: `3-room-apartment-for-sale-in-kentron-yerevan`.
- Collision: the first free of `base`, `base-2`, `base-3`, … (bounded at 1000). An existing row is never renamed or
  modified (tested: an unrelated pre-existing row holding the base kept its md5; the draft got `-2`).
- Race: if a concurrent insert takes the chosen slug between the check and the insert, the `properties_slug_key`
  violation is caught and the next suffix is tried (tested with a simulated concurrent writer → `…-2`).
- Stable: the slug is chosen once, inside the creating transaction, and never recomputed (retries return the existing
  draft).
- Non-Latin words (e.g. an Armenian district name) are dropped from the slug; the suffix rule keeps it unique.

## 9. Idempotency

| Layer | Mechanism |
| --- | --- |
| database | `properties.created_from_session_id` **unique** — at most one property per session, ever |
| lock | the session row is locked (`FOR UPDATE`) for the whole generation, so concurrent calls for one session serialize |
| atomicity | insert + `extraction_results.property_id` + `submission_sessions.property_id` + `property.draft_created` event commit together or not at all |
| repeat call | if the session already has a draft created from this extraction → `outcome: duplicate` with the same id/slug (no event noise beyond `property.generation_duplicate`) |
| other extraction, same session | `update_not_supported` (section 3) |

n8n execution ids are only correlation labels (`correlation_id`); they are not part of any key.

Tested: the same extraction processed 3× (two workers + same execution retried) → 1 draft; recovery sweep afterwards →
nothing to do; worker retry after a failure and after the successful insert → `duplicate`; duplicate WhatsApp webhook →
one message → one session → one draft (Phase 4/5 guarantees upstream).

## 10. Failures and retries

| Failure | Behaviour |
| --- | --- |
| extraction not valid / session not eligible / stale / already linked | rejected, event, no retry needed |
| ownership broken | rejected, session → `needs_review` |
| permanent DB error inside the insert block (e.g. constraint, trigger failure, **automation event insert failure**) | the whole insert block rolls back (no property, no links); `property.generation_failed` (SQLSTATE + redacted message) is recorded; `outcome: failed, retryable: true` |
| same failure 3 times for one extraction | session → `needs_review` (`property_generation_failed`), `property.generation_abandoned`; no further automatic attempts |
| transient DB error (statement timeout, cancellation, deadlock, serialization, lock timeout, connection) | re-raised: the whole call rolls back with **nothing** written; the caller/sweep simply retries |
| Supabase unreachable from n8n | HTTP retries 3×, then routed to *Draft generation deferred*; the next run's sweep creates the draft |
| worker crashes after the insert committed | the next call or sweep returns `duplicate` |

Original WhatsApp messages, sessions and extraction results are never modified or deleted by any failure (only
`extraction_results.property_id` / `submission_sessions.property_id|kind|status|last_error` change on success or
routing).

## 11. n8n integration (*VIP Realty — Submission Extraction*)

```
Every minute → Advance session buffers → Generate pending property drafts (sweep, never blocks)
             → Claim next ready session → Session claimed? → Run AI extraction → Record extraction result
             → Extraction valid? ──yes──► Generate property draft ─► Draft outcome recorded (review pending, not public)
                                 │                               └─(unavailable)► Draft generation deferred (sweep retries)
                                 └──no───► Not valid — no draft (session needs review)
```

- *Extraction valid?* only routes on the `validation_status` Supabase returned; `generate_property_draft` re-checks
  everything itself. Invalid, incomplete and conflicting results never reach the generation call (tested).
- AI (sub-workflow) and property mutation (database function) remain separate steps. No property business logic is in
  n8n. *WhatsApp Inbound* and *Property Extraction (AI)* are unchanged.
- New HTTP nodes use the same pending credential `VIP Realty Supabase (service role)`. The workflow stays inactive.

## 12. Provenance

`property.created_from_session_id` → session → `whatsapp_messages.session_id` (source messages) and `agent_id`/
`agency_id`; `extraction_results.property_id` (+ `metadata.automation.extraction_result_id` and
`extraction_attempt_id`) → the exact extraction attempt, its input hash, raw model output and validation;
`automation_events.property_id/session_id` → the generation trail. Verified for every test draft
(`every_draft_traceable = true`). The property itself stays a clean business record.

## 13. Public visibility guarantee

A real draft was generated end to end from Armenian WhatsApp text through the real AI
("Վաճառվում է 2 սենյականոց բնակարան Դավթաշենում, Երևան… Գինը՝ 98000 դոլար" → slug
`2-room-apartment-for-sale-in-davtashen-yerevan`, `draft` / `pending`; inferred country and the model's "2-bedroom"
title were removed by the Phase 5 guards, so the deterministic title was used). Then:

| Check | Result |
| --- | --- |
| row in `properties` | yes — draft, pending, `published_at` null |
| `published_property_listings` (SQL) | 0 rows |
| anon REST `published_property_listings?slug=eq.<slug>` | `[]` |
| anon REST `properties?slug=eq.<slug>` (RLS) | `[]`; non-public columns → 401 |
| anon REST insert into `properties` / call generation RPCs | 401 |
| website (production build, publishable key) `/properties/<slug>` | **404** (also for 3 other test drafts) |
| website `/properties` index | 200, `listings: []` (public read working), no draft |
| website `/properties?district=davtashen` | no draft |
| website home district map | "Davtashen, 0 properties" |

The key was supplied only as a runtime environment variable of the local test server; `.env.local` was not changed.

## 14. Security

- `generate_property_draft`, `generate_pending_property_drafts` and the title/slug helpers: `SECURITY INVOKER`,
  `EXECUTE` for `service_role` only (anon/authenticated denied — verified in the catalog and over REST).
- The function takes only an extraction result id; it never accepts agency/agent/property ids, statuses, SQL or column
  names. All writes are fixed statements; AI text is only ever a value.
- No new RLS policy, no grant to anon/authenticated, no new public read path. RLS on all tables (0 without), 5
  policies (unchanged). Security advisors: no new findings.

## 15. Legacy properties

The six legacy drafts are untouched (full-row and legacy-column fingerprints identical before and after all tests). They
have no session, so the generator cannot reach them, and there is no matching logic that could. Future handling (a
later reviewed phase): an admin decides per row to archive, re-enter through WhatsApp, or complete and approve; any
migration will be an explicit, reviewed operation — never automatic.

## 16. Tests (all with `zz-phase6-test-*` data; 18 test agents in one test agency + one "other" agency)

| # | Scenario | Result |
| --- | --- | --- |
| A | valid new listing | PASS — 1 draft, draft/pending/whatsapp, owner = session agent/agency, both links set, AI title accepted |
| B | invalid extraction | PASS — rejected `extraction_not_valid`, 0 rows |
| C | incomplete extraction | PASS — rejected, 0 rows |
| D | conflicting extraction | PASS — rejected, 0 rows |
| — | failed extraction (AI timeout recorded) | PASS — rejected `extraction_not_succeeded`, 0 rows |
| E | duplicate processing (same extraction 3×, same n8n execution retried, sweep) | PASS — 1 draft, `duplicate` ×2, sweep processed 0 |
| F1 | property insert fails, retry after fix (sweep) | PASS — failed (retryable), then created by sweep; further retry `duplicate`; 1 draft |
| F2 | `property.draft_created` event insert fails | PASS — whole block rolled back (0 drafts), failure recorded; retry → 1 draft |
| F3 | permanent failure | PASS — 3 failures → `needs_review` + `generation_abandoned`; 4th call rejected; 0 drafts |
| F4 | database timeout during insert | PASS — statement cancelled, nothing written (0 drafts, 0 events), messages/extraction intact; retry → 1 draft; again → `duplicate` |
| G1 | unknown sender | PASS — no session, no extraction, 0 drafts |
| G2 | agent moved to another agency | PASS — `ownership_failed (agency_mismatch)`, session `needs_review`, 0 drafts |
| H | inactive agent | PASS — `ownership_failed (agent_inactive)`, session `needs_review`, 0 drafts |
| I-a | same listing from two sessions | PASS — `…-nor-nork-yerevan` and `…-2` |
| I-b | unrelated row holds the base slug | PASS — draft `…-davtashen-yerevan-2`, holder unchanged |
| I-c | concurrent writer takes the slug mid-insert | PASS — unique violation handled → `…-2` (first harness version looped to the 1000 bound because the simulated writer was rolled back with the subtransaction; the bound turned it into a recorded, retryable failure — also a pass for the safety limit) |
| J | legacy properties | PASS — unchanged (md5) |
| K | explicit update (reprocessed session, second valid extraction) | PASS — `update_not_supported`, draft unchanged, session `needs_review`, sweep ignores |
| K2 | same agent re-sends the same listing (new session) | PASS — new draft `…-2`, no fuzzy update |
| S | stale attempt (older extraction after a newer one) | PASS — `session_not_completed` while re-queued, `stale_extraction` afterwards; sweep uses only the current one |
| L | public visibility with a real AI-generated draft | PASS — section 13 |
| — | insert guard (published/approved/no review) | PASS — rejected |
| — | title policy (8 AI titles) and generated titles (6 shapes) and slugs | PASS |
| — | n8n: valid → generate; incomplete → never generates; generate unavailable → 3 tries → deferred | PASS |
| — | privileges: anon RPC/insert/REST | PASS — 401 / `[]` |

Not tested: truly parallel generation calls from two connections (the MCP executes SQL sequentially); correctness
relies on the session row lock, the unique `created_from_session_id` and the handled slug unique violation. The live
n8n → Supabase call (no `supabaseApi` credential exists in n8n) — database functions were exercised directly.

Repository and database: typecheck ✔, lint ✔, build ✔, secret scan ✔, migrations md5-identical to the applied remote
versions ✔, RSVP and legacy fingerprints unchanged ✔, published listings 0 ✔, property images 0 ✔.

### Cleanup

All `zz-phase6-test` data deleted and verified: agencies 0, agents 0, sessions 0, messages 0, media 0, extraction
results 0, automation events 0, automation properties 0 (only the 6 legacy rows remain, fingerprint identical),
property images 0, storage objects 0, no temporary triggers/functions/tables left. n8n test executions (AI sub-workflow
22; Submission Extraction 23–25) contain only synthetic `zz-phase6-test` data and can be deleted in the n8n UI.

## 17. Migrations and rollback

| Migration | Content |
| --- | --- |
| `20260918082610_property_draft_generation` | insert guard, `completed → needs_review` edge, title/slug helpers, `generate_property_draft`, `generate_pending_property_drafts` |
| `20260918083305_property_slug_digit_groups` | slug: remove digit-group commas |

Rollback (deactivate the Phase 6 nodes first; drafts already created stay as ordinary non-public drafts unless deleted
deliberately):

```sql
drop function public.generate_pending_property_drafts(integer, text);
drop function public.generate_property_draft(uuid, text);
drop function public.property_slug_base(text);
drop function public.property_title_supported(text, jsonb);
drop function public.property_draft_title(jsonb);
drop trigger properties_automation_insert_guard_trg on public.properties;
drop function public.properties_automation_insert_guard();
-- restore submission_sessions_status_transition() from 20260917172539_session_buffering.sql (removes completed -> needs_review)
```

In n8n: remove *Generate pending property drafts*, *Extraction valid?*, *Generate property draft* and the two outcome
no-ops, and reconnect *Advance session buffers → Claim next ready session* and *Record extraction result →* its
no-op (see the Phase 5 export).

## 18. Limitations

- Create-only: corrections to an existing listing arrive as a new draft or a `needs_review` session; reviewers merge.
- Title/slug are English; Armenian/Russian-only place names disappear from the slug (uniqueness kept by suffixes).
- A retried generation after a *permanent* error only succeeds if the cause was fixed; after 3 failures a human decides.
- `property.generation_failed` counting uses the event trail for that extraction.
- The generator trusts Phase 5 validation for field semantics; the database constraints re-check types and ranges.

## 19. Next phase (Phase 7)

Admin review and publishing: list automation drafts (`created_from_session_id is not null`, `review_status = pending`)
with provenance (messages, extraction, validation issues, media metadata); edit fields; approve / reject; explicit
publish (`review_status = approved` → `listing_status = published`) and unpublish/archive; handling of sessions in
`needs_review` (update requests, ownership problems, abandoned generations, invalid/incomplete/conflicting
extractions) including explicit, reference-based updates of existing drafts; legacy-row decisions. Media download,
WhatsApp replies, sold/rented commands, notifications and deployment follow in later phases.
