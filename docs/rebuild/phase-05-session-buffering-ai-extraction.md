# Phase 5 — Session Buffering & AI Property Extraction

Status: **complete**. Branch `phase/05-session-buffering-ai-extraction` (from Phase 4 commit `7b4aa93`).

> WhatsApp messages → deterministic session buffering → claimed submission → AI structured extraction →
> deterministic validation → **append-only extraction result**.
> The output of this phase is an extraction result, **not a property**. Nothing in Phase 5 inserts, updates or
> publishes `properties`, `property_images` or any public read model.

No secrets, tokens or credential values appear in this document or in the repository.

---

## 1. What Phase 4 already did (inspected first)

`ingest_whatsapp_message` stored every inbound message once, resolved active agents and attached their messages to
the conversation's single `open` session (`buffered`). Nothing ever closed a session. `extraction_results` existed
(append-only for `service_role`, one `status` + `validation_status`) but nothing wrote to it. The Phase 4 n8n workflow
`VIP Realty — WhatsApp Inbound` is **unchanged**: commands and debounce were added inside the database function it
already calls, so no ingestion logic is duplicated.

## 2. Architecture

```
WhatsApp Inbound (Phase 4, unchanged)             VIP Realty — Submission Extraction (every minute)
  └─ ingest_whatsapp_message (extended)             ├─ advance_submission_sessions()    open → ready (quiet period / cap),
       · message stored once                        │                                    expired leases → retry/fail
       · finish / cancel commands                   ├─ claim_submission_session()       ready → processing (SKIP LOCKED)
       · session debounce + hard cap                ├─ Execute Sub-workflow ──► VIP Realty — Property Extraction (AI)
       · late media after "done"                    │                               Build request → Anthropic → raw text
                                                    ├─ record_extraction_result()      validate, append result,
                                                    │                                  processing → completed | needs_review
                                                    └─ record_extraction_failure()     retry with backoff | failed
```

**Why no `Wait 5 minutes` node:** a per-message wait would start one delayed execution per message (A, B, C → three
timers) and each would have to decide whether it is "the last one" — a race by construction. Instead all timing lives in
the database (`process_after`), every message only pushes the deadline forward, and a single idempotent sweep turns due
sessions into `ready`. Overlapping scheduler runs are harmless because claiming is an atomic row-locked transition.

## 3. Session lifecycle (existing status vocabulary — no new states)

| Required state | Status used | Meaning |
| --- | --- | --- |
| active / buffering | `open` | accepting messages; `process_after` = earliest time it may become ready |
| ready | `ready` | frozen submission; `process_after` = earliest claim time |
| processing | `processing` | claimed by exactly one worker (`processing_attempt_id`) |
| processed | `completed` (valid) / `needs_review` (incomplete, conflicting, invalid) | an extraction result exists |
| cancelled | `cancelled` | agent cancel command, or no content at claim time |
| failed | `failed` | attempts exhausted |

Allowed transitions (enforced by trigger `submission_sessions_status_transition_trg`; anything else raises):

```
insert            → open (only)
open              → ready | cancelled
ready             → processing | cancelled
processing        → completed | needs_review | ready (retry / lease expired) | failed
needs_review      → ready (reprocess) | cancelled
completed, failed → ready (explicit reprocess)
```

Every transition has one cause: quiet period, hard cap, finish command, cancel command, claim, validated result,
recorded failure, expired lease, or explicit reprocess request — each written to `automation_events`.

## 4. Timing configuration

`public.submission_buffer_config(agency_id)` is the only place timings are defined. Defaults can be overridden per
agency with `agencies.settings.submission_buffer.<key>` (integers within bounds; invalid values fall back).

| Key | Default | Bounds | Used for |
| --- | --- | --- | --- |
| `quiet_period_seconds` | 300 | 30–86400 | open session becomes ready after this long without a new content message |
| `media_settle_seconds` | 90 | 0–3600 | media delays readiness at least this long; after `done`, claim waits this long for late photos |
| `max_session_seconds` | 3600 | 300–86400 | hard cap from session creation (`created_at`, server clock) |
| `processing_lease_seconds` | 900 | 60–7200 | a claimed attempt without a recorded outcome expires |
| `max_extraction_attempts` | 3 | 1–10 | failures before `failed` |
| `retry_backoff_seconds` | 120 | 0–86400 | retry delay × attempt number |

Buffering decisions use the server clock (`now()`), never provider timestamps, so delayed or wrong device clocks
cannot shorten or extend a submission.

## 5. Buffering rules

- **Content message from an active agent:** reuse the conversation's `open` session or open one;
  `process_after = least(created_at + cap, greatest(previous, now + quiet, media ? now + settle))`.
  Messages A (t), B (t+2 s), C (t+20 s) therefore land in **one** session whose deadline is t+20 s+5 min.
- **Sweep** (`advance_submission_sessions`, `FOR UPDATE SKIP LOCKED`): `open` sessions with `process_after <= now`
  become `ready` with reason `quiet_period`, or `max_duration` when the cap was reached.
- **Hard cap:** `process_after` can never exceed `created_at + 60 min`, so an agent typing every few minutes cannot
  keep a session open. If a message arrives for an open session past its cap before the sweep ran, ingestion marks it
  `ready` (`max_duration`) and opens a new session for the new message. Nothing is discarded.
- **Late media:** after `done`, a photo delivered while the session is still `ready` and inside its settle window
  (and within the cap) joins that session and extends the window by 90 s. Text after `done` opens a new session.
- **Unknown/inactive senders:** unchanged from Phase 4 (`unresolved_sender`, no session, never extracted, no commands).
- **Duplicate webhook:** the duplicate path returns before any session or command logic, so redelivery never
  re-runs a command, re-opens a session or causes another extraction.

## 6. Explicit commands

A **whole** text message from an active agent, after trimming surrounding whitespace/punctuation (incl. Armenian
`։ ՝ ՜ ՞`) and lowercasing, must equal one of:

| Command | Accepted messages | Effect |
| --- | --- | --- |
| finish | `done`, `finish`, `finished`, `complete`, `готово`, `վերջ` | open session → `ready` immediately (`done_command`); claimable after the media settle period |
| cancel | `cancel`, `stop`, `отмена`, `չեղարկել` | open (or not-yet-claimed ready) session → `cancelled`; its buffered messages → `ignored` |

Anything else is content: `cancelled building`, `done deal 3 rooms`, `please cancel`, `stopped`, `ok done` (tested).
Commands with no target session are stored as `ignored` with a `whatsapp.command_ignored` event. Command messages
are marked `whatsapp_messages.command` and are never part of the extraction input. Commands cannot touch a session
that is already `processing` or finished.

## 7. Race conditions and claiming

| Situation | Mechanism |
| --- | --- |
| A, B, C within seconds | single `open` session per conversation (partial unique index) + `on conflict do nothing` + row lock on the open session; each message only extends `process_after` |
| two messages at the same instant with no open session | one `INSERT` wins on the unique index, the other re-reads and reuses (bounded retry) |
| duplicate webhook | unique `(provider, provider_message_id)`; duplicate path exits before session/command logic |
| sweep vs. arriving message | both lock the session row; the sweep uses `SKIP LOCKED` and re-checks, ingestion re-reads `status = 'open'` after the lock (a session that just became ready is never extended — the message opens a new session) |
| processing starts while a message arrives | claimed sessions are no longer `open`/eligible; the new message opens a new session; the claimed input is hash-checked again when the result is recorded (`input_changed` → retry) |
| two workers claim | `claim_submission_session`: `SELECT … FOR UPDATE SKIP LOCKED LIMIT 1` + `ready → processing` in one transaction; a second worker gets another session or `claimed: false` |
| two results for one attempt | `extraction_results.attempt_id` unique; the result function locks the session first, then checks for an existing result → second call returns `duplicate` |
| stale worker (lease expired, retried elsewhere) | results are accepted only for the session's *current* `processing_attempt_id`; late calls get `duplicate` (the expiry already recorded a failed result for that attempt) or `stale_attempt` |
| worker crash | lease expiry in the sweep records a `failed` result (`lease_expired`) and retries or fails the session |

Timing of n8n executions is never relied upon.

## 8. Canonical extraction input (`build_extraction_input`)

```json
{ "schema": "vip-realty.extraction-input.v1", "channel": "whatsapp",
  "sender": {"role": "agent", "name": "<agent name>"}, "message_count": 4, "media_count": 2,
  "messages": [ {"seq": 1, "sent_at": "2026-09-17T17:01:00Z", "sender": "agent", "type": "text", "text": "House for rent in Dilijan…"},
                {"seq": 2, "sent_at": "…", "type": "image", "text": "Living room",
                 "media": [{"kind": "image", "mime_type": "image/jpeg", "provider_media_id": "…"}]},
                {"seq": 3, "type": "document", "media": [{"kind": "document", "filename": "floor-plan.pdf", "mime_type": "application/pdf", "provider_media_id": "…"}]} ] }
```

- Order: provider timestamp → arrival → provider message id (deterministic tie-break). Command messages, reactions,
  system messages and stickers are excluded; `reply_to_seq` links replies.
- Contains **no** database ids, phone numbers, raw provider payloads, URLs or credentials (verified: 0 sessions matched
  a scan for `+374`, `raw_payload`, `wamid`, `agency_id`, `agent_id`, `session_id`).
- `input_hash` = SHA-256 of the JSON; stored on the session at claim and on the result; recomputed before recording.
- Internal message ids are returned separately to the database functions and never sent to the AI.

## 9. AI provider and prompt

- **Provider:** the n8n AI capability already in the environment — the n8n managed ("Gateway credits") Anthropic
  credential. No second provider and no API key to manage.
- **Model:** `claude-haiku-4-5-20251001`, temperature 0, max 4096 tokens. Claude Sonnet is not offered through the
  gateway (tested: "Gateway credits don't currently support this operation"); switching models later needs only the
  node's model id and a new model name in the result.
- **Prompt:** `automation/prompts/property-extraction-v1.md` (source of truth). The sub-workflow Code node embeds the
  identical text (verified byte-for-byte before export). Every result records `prompt_version`.
- **Output schema:** `automation/prompts/property-extraction-v1.schema.json` (`schema_version` "1").
- The prompt requires JSON only, all 23 fields, `unknown = null`, verbatim evidence, conflict entries, no inference of
  city/country/currency/intent, sale vs rent only from explicit words, rooms vs bedrooms kept distinct, canonical
  vocabulary for Armenian/Russian/English terms, and no publishing or visibility decisions. Message text is data,
  never instructions.
- The sub-workflow has no database access, no tools and can only be called by *VIP Realty — Submission Extraction*
  (caller policy). Its execution timeout (120 s) is the AI timeout.

### Extraction schema (per field)

`fields.<name> = {value, status, source_messages, evidence}` for: title, description, intent, property_type, country,
city, district, address, latitude, longitude, price, currency, price_negotiable, price_period, area_sqm, land_area_sqm,
rooms, bedrooms, bathrooms, floor, total_floors, year_built, features; plus `conflicts`, `notes`, `languages`.

| status | value | meaning |
| --- | --- | --- |
| `explicit` | required | stated directly |
| `normalized` | required | stated differently, converted (units, language, `180k$`) |
| `uncertain` | required | hedged ("maybe 3 bathrooms") — kept in `fields`, **excluded from property data** |
| `conflicting` | must be null | different values, no stated correction (needs a `conflicts` entry, `unresolved`) |
| `unknown` | must be null | not stated |

Source agent, agency, session and message ids are **not** produced by the AI; `extracted_data.source` is written by the
database from the claimed session.

## 10. Deterministic validation (outside the AI)

`record_extraction_result` parses the raw text (one surrounding ```` ``` ```` fence tolerated) and calls
`validate_property_extraction`:

**Structure (`validate_property_extraction_structure`)** — `invalid` on any error:
top-level keys; all 23 fields present, no extra fields; entry keys; status enum; value/status consistency; source
message numbers exist; **verbatim evidence** from the cited messages (anti-hallucination); enums (intent, 12 property
types, currency USD/AMD/EUR/RUB, price period); country `^[A-Z]{2}$`; numeric types and ranges mirroring the
`properties` constraints (price > 0, area 0–100000, rooms/bedrooms 0–50, bathrooms 0–20, floor −5–200, total floors
1–200, year 1800–now+5, lat/long ranges, integers); features snake_case, unique; text lengths; latitude/longitude pairs;
floor ≤ total floors; no price period for sales; conflict entries well-formed and consistent with field statuses;
notes/languages shape.

**Semantic guards** — unsupported values are *removed from property data* and flagged (the raw claim stays in
`extracted_data.fields` for audit):
intent evidence must contain a sale/rent term (en/ru/hy + transliterations); `country = AM` evidence must name Armenia;
city evidence must name the city (Latin/Armenian/Russian spellings for common Armenian cities, otherwise the value
itself); a title claiming bedrooms needs established bedrooms; a `latest_correction` needs correction wording in the
latest cited message, otherwise the conflict counts as unresolved.
These guards were added because the real model did exactly these things during testing (section 15).

**Result:** `invalid` (any error) › `conflicting` (unresolved conflict) › `incomplete` (missing any of intent,
property_type, city, price, currency) › `valid`. Issues are stored as `{severity: error|review|warning, code, field,
message}` in `validation_errors`; per-field statuses in `confidence.field_status`; trusted values only in
`extracted_data.property` (empty when invalid).

## 11. Extraction results and idempotency

Every attempt appends exactly one `extraction_results` row (never updated):

| Column | Content |
| --- | --- |
| `session_id`, `agency_id`, `input_message_ids` | deterministic provenance |
| `attempt_id` (unique), `attempt_number` | processing attempt |
| `provider`, `model`, `prompt_version`, `schema_version` | extraction version |
| `input_hash` | SHA-256 of the canonical input |
| `raw_output` | verbatim model text (≤ 200 000 chars) |
| `status` | `succeeded` / `invalid_output` (unparseable) / `failed` (AI/workflow/lease error) |
| `extracted_data` | `property` (trusted), `fields`, `conflicts`, `notes`, `languages`, `media` (with seq), `source` |
| `confidence`, `validation_status`, `validation_errors` | validation outcome |
| `error` | redacted error code and message for failures |
| `created_at` | timestamp |

- **Same attempt → idempotent:** the unique `attempt_id` plus lock-then-check makes repeated result/failure calls
  return `duplicate` with the original row.
- **Intentional reprocessing → new result:** `request_session_reprocessing(session_id, reason)` moves `completed`,
  `needs_review` or `failed` back to `ready` (attempt counter reset); the next claim creates a new `attempt_id`, so a new
  row is appended and earlier results stay untouched. A later phase (admin) will call it.

## 12. Failures and retries

| Failure | Handling |
| --- | --- |
| AI timeout / rate limit / API error / invalid input | sub-workflow fails → *Classify AI failure* (`ai_timeout`, `ai_rate_limited`, `ai_error`, `invalid_input`) → `record_extraction_failure` |
| malformed JSON / not an object with `fields` | `invalid_output` result, retried |
| schema, enum, range, hallucination problems | `succeeded` result with `validation_status = invalid` → `needs_review` (not retried automatically; reprocess on demand) |
| Supabase unavailable (advance/claim) | HTTP retries 3×; execution fails; next minute retries; no state changed |
| Supabase unavailable when recording | HTTP retries 3× → execution fails deliberately; the lease expires → failed attempt recorded → retried |
| n8n crash mid-run | same lease expiry path |
| input changed during processing | `input_changed` failure → retried with the new input |

Retry = `ready` with `process_after = now + 120 s × attempt`; after 3 attempts → `failed` (closed, messages `failed`).
Failures never create or modify a property, never lose messages (they stay in `whatsapp_messages`) and never mark a
session `completed`. Error text is truncated and redacted (`Bearer …`, `sk-…`, JWTs, Supabase keys) before storage.

## 13. Observability (`automation_events`)

`session.opened`, `session.ready` (reason: quiet_period | max_duration | done_command; detected_by), `session.cancelled`
(cancel_command | no_content), `extraction.started` (attempt, counts, input hash), `extraction.succeeded`,
`extraction.incomplete`, `extraction.conflicted`, `extraction.invalid` (with error/review/warning counts, model,
prompt version), `extraction.failed` (error code, result id), `extraction.retried` (next attempt, not before),
`session.failed`, `session.reprocess_requested`, `extraction.stale_attempt`, `whatsapp.command_ignored` — plus the
Phase 4 ingestion events. `correlation_id` carries the n8n execution id. No secrets, phone numbers or message text are
written to events.

## 14. Security

- AI output is untrusted text: it is parsed as JSON only, never executed, and cannot choose tables, SQL, credentials,
  ids, agency ownership or permissions. All writes are fixed statements inside `SECURITY INVOKER` functions.
- Agent/agency/session relationships come only from Phase 4 ingestion data.
- All new functions: `EXECUTE` for `service_role` only. Verified over REST with the publishable key: every Phase 5 RPC
  → 401 `permission denied`; anonymous reads of `extraction_results` and `submission_sessions` → 401.
- RLS unchanged (0 tables without RLS, 5 policies); no public read path added. Security advisors: no new findings.
- Service-role key: n8n credential only. AI credential: n8n managed. Nothing added to Next.js or its environment.
- Grep of all Phase 5 function bodies: **0** `INSERT/UPDATE/DELETE` against `properties` or `property_images`
  (the only mention is a comment in the validator).

## 15. Tests

All test data used `zz-phase5-test-*` identifiers (agency `zz-phase5-test-agency`, message ids
`wamid.zz-phase5-test-*`, media ids `zz-phase5-test-media-*`, correlation `zz-phase5-test:*`). Time was simulated by
moving `process_after` / `created_at` / `processing_started_at` backwards on test rows.

### Buffering, commands, cap, idempotency, races (Supabase, as `service_role`)

| Test | Result |
| --- | --- |
| Command parser: 18 inputs (done, `  Done!! `, DONE., готово, Վերջ։, finish, complete, cancel, Stop!, Отмена, չեղարկել vs cancelled building, done deal 3 rooms, please cancel, stopped, stop the sale of flat, empty, ok done) | PASS — only exact commands matched |
| **B** three messages → one session; sweep/claim before quiet period do nothing | PASS |
| Quiet period elapsed → sweep → `ready (quiet_period)` | PASS |
| **F** `done` → `ready` immediately, claimable after 90 s; redelivered `done` → duplicate, no effect | PASS |
| **F** photo right after `done` joins the ready session (`late_media`); text after `done` → new session | PASS |
| `done` / `stop` with no active session → `ignored` + event | PASS |
| **G** "cancelled building…" is content; `cancel` → `cancelled`, 2 messages `ignored`, never claimable | PASS |
| **H** message at minute 58 → `process_after` capped at minute 60 (120 s ahead) | PASS |
| **H** sweep at minute 61 → `ready (max_duration)` | PASS |
| **H** message for an open session past its cap → old session `ready (max_duration)`, new session opened | PASS |
| **I** same message delivered 3× → 1 row (`delivery_count 3`), one session, one extraction | PASS |
| **J** two claims for one due session → first `claimed: true`, second `claimed: false` | PASS — the MCP ran them sequentially, so this proves the status guard; simultaneous exclusion relies on `FOR UPDATE SKIP LOCKED` (not load-tested) |
| Claimed input hash stable when rebuilt | PASS |
| Invalid transitions: open→completed, open→processing, open→failed, cancelled→ready, completed→needs_review, insert as ready | PASS — all rejected |
| Phase 4 regression: unknown sender (incl. "done" from unknown sender = not a command), unroutable, malformed, derived id + redelivery | PASS |

### AI extraction with the real model (n8n sub-workflow, Claude Haiku 4.5)

| Scenario | Messages | Validation | Session | Notes |
| --- | --- | --- | --- | --- |
| **A** complete, English | 1 | valid | completed | model inferred `country AM` from "Yerevan" → removed by guard |
| **B** multi-message | 3 | incomplete | needs_review | no sale/rent word → intent unknown (correct) |
| **C** text + image + PDF | 4 | valid | completed | `media` holds 2 references with seq, mime, filename |
| **D** "Apartment in Yerevan" | 1 | incomplete | needs_review | intent, price, currency missing |
| **E** two prices, "maybe 3 bathrooms" | 3 | conflicting | needs_review | model claimed a correction without correction wording → guard → unresolved; bathrooms kept out as uncertain |
| Stated correction "Sorry, correction: actually 270k" | 2 | valid | completed | price 270000 with `corrected_value` warning |
| **Armenian** "Վաճառվում է 3 սենյականոց բնակարան Արաբկիրում, Երևան…" | 1 | valid | completed | buy, apartment, Yerevan/Arabkir, 165000 USD, 85 m², 4/9, renovated; "3-bedroom" title and inferred country removed |
| **Mixed** "Վարձով office Kentron-ում, Yerevan" + "120 sqm, 2-րդ հարկ, parking կա։ 900000 դրամ ամսական" | 2 | valid | completed | rent, office, AMD, month, floor 2, parking |
| First prompt draft on B | 3 | invalid | needs_review | omitted bedrooms/bathrooms, guessed intent and country → prompt tightened, guards added, session reprocessed → new attempt, new result |
| Orchestrator run (main workflow → sub-workflow → AI), Supabase nodes stubbed | 3 | — | — | PASS: real AI output routed to *Record extraction result* |
| "garage for sale in Avan" (orchestrator, Supabase unavailable) | 1 | — | — | model inferred city Yerevan from district Avan → city guard added (re-validated: incomplete) |

All 8 stored real-model results re-validated with the final guards produced the same statuses.
Raw WhatsApp messages were never translated or modified.

### Malformed / failing AI and retries (Supabase)

| Test | Result |
| --- | --- |
| Malformed JSON | `invalid_output` result, session `ready` with 120 s backoff; claim during backoff → nothing |
| Same attempt recorded again / reported as failure | `duplicate`, no new row |
| AI timeout (error text containing a bearer token) | `failed` result, token stored as `[redacted]`, retry backoff 240 s |
| Third failure | session `failed` (closed), messages `failed`, `session.failed` event; not claimable |
| Reprocess `failed` → new attempt | new result row appended |
| AI missing fields | invalid: `missing_field` bedrooms, bathrooms |
| Unexpected enums (`castle`, `GBP`, status `sure`) | invalid: `invalid_value`, `invalid_status` |
| Hallucinated values (price 15000 quoted "15000 USD", bedrooms "two bedrooms", seq 7 of 1, negative area) | invalid: `evidence_not_found` ×2, `invalid_source_messages` |
| Extra top-level `publish: true` and field `listing_status: published` | invalid: `unexpected_key`, `unexpected_field` |
| Well-formed garage without city | incomplete |
| Older attempt id after retries / unknown attempt id | `duplicate` / `stale_attempt` |
| Reprocess a cancelled session | `not_allowed` |
| Worker crash: lease 16 min old → sweep | `failed` result `lease_expired`, session `ready`; late result from the crashed worker → `duplicate` |
| 8 results for one session over 8 attempts | 8 rows, 8 distinct attempt ids, max 1 row per attempt |

### n8n

| Test | Result |
| --- | --- |
| Sub-workflow with gateway credential (Sonnet 4.5) | FAIL (gateway does not support it) → switched to Haiku 4.5 |
| Sub-workflow with Haiku 4.5, system prompt, temperature 0 | PASS (11 real model calls) |
| Main workflow happy path (claim pinned, real AI, record pinned) | PASS |
| AI failure path (invalid input → sub-workflow error → classify `invalid_input` → record failure) | PASS |
| Supabase unavailable at record (real HTTP node, no credential) → 3 attempts → *Fail: result not recorded* | PASS |
| Classifier unit test (timeout, 429, overloaded, invalid input, bad request, undefined) | PASS |

### Not tested

- Live n8n → Supabase calls (no `supabaseApi` credential exists in n8n; the n8n runs and the database runs were joined by
  executing the database functions with the exact claimed inputs and the real model outputs; model outputs were
  transferred as equivalent compact JSON, fences removed).
- Truly simultaneous claims/ingestion (the MCP executes SQL sequentially; correctness relies on row locks and unique
  indexes).
- A real AI timeout (simulated through the failure function and the classifier).
- The ingestion `schema_violation` handler (defensive; not reachable through validation).

### Repository and database checks

typecheck ✔, lint ✔, build ✔ (12 routes, unchanged), secret scan of the staged diff ✔ (no keys/tokens), migrations in the
repo byte-identical (md5) to the applied remote migrations ✔, RSVP fingerprint unchanged ✔, 6 legacy properties
fingerprints unchanged ✔, published listings 0 ✔, property images 0 ✔, storage objects 0 ✔, booking objects 0 ✔.

### Cleanup

All `zz-phase5-test` rows deleted and verified: agencies 0, agents 0, sessions 0, messages 0, media 0, extraction
results 0, automation events 0, inquiries 0, property images 0, storage objects 0. The n8n **test executions**
(Property Extraction (AI) 4–8, 10–17; Submission Extraction 9, 18, 20) contain only synthetic `zz-phase5-test`
content; they can be deleted from each workflow's Executions list (not possible with the available tooling).

## 16. Migrations and rollback

| Migration | Content |
| --- | --- |
| `20260917172539_session_buffering` | config, commands, state machine trigger, processing columns, `whatsapp_messages.command`, extended ingestion, sweep |
| `20260917172742_extraction_pipeline` | result columns, input builder, structural validator, claim, record result/failure, reprocess |
| `20260917173727_extraction_semantic_guards` | validator split into structure + guards (superseded) |
| `20260917174454_extraction_semantic_guards_v2` | guards remove unsupported values; correction wording check |
| `20260917174930_extraction_semantic_guards_v3` | city evidence guard (current) |

Rollback (reverse order; deactivate the two Phase 5 workflows first and make sure no session is `processing`):

```sql
drop function public.validate_property_extraction(jsonb, jsonb);
drop function public.request_session_reprocessing(uuid, text);
drop function public.record_extraction_failure(uuid, text, text, text, text, text, text);
drop function public.record_extraction_result(uuid, text, text, text, text, text);
drop function public.advance_submission_sessions(text);
drop function public.apply_extraction_failure(uuid, text, text, text, text, text, text, text, text);
drop function public.claim_submission_session(text);
drop function public.validate_property_extraction_structure(jsonb, jsonb);
drop function public.build_extraction_input(uuid);
drop function public.redact_error_text(text);
drop function public.extraction_evidence_text(text);
drop function public.extraction_issue(text, text, text, text);
drop index public.extraction_results_attempt_key;
alter table public.extraction_results drop constraint extraction_results_validation_status_check,
  drop column attempt_id, drop column attempt_number, drop column schema_version, drop column input_hash, drop column raw_output;
alter table public.extraction_results drop constraint if exists extraction_results_prompt_version_format;
alter table public.extraction_results add constraint extraction_results_validation_status_check
  check (validation_status in ('valid', 'invalid', 'needs_review'));   -- only if no rows use incomplete/conflicting
-- restore the Phase 4 ingest_whatsapp_message from 20260917165925_whatsapp_ingestion_foundation.sql (create or replace)
drop trigger submission_sessions_status_transition_trg on public.submission_sessions;
drop function public.submission_sessions_status_transition();
drop index public.submission_sessions_processing_attempt_key;
drop index public.submission_sessions_open_created_idx;
alter table public.submission_sessions drop constraint submission_sessions_processing_consistency,
  drop constraint submission_sessions_processing_input_hash_format, drop constraint submission_sessions_processing_attempts_check,
  drop column processing_attempt_id, drop column processing_attempts, drop column processing_started_at, drop column processing_input_hash;
alter table public.whatsapp_messages drop constraint whatsapp_messages_command_check, drop column command;
drop function public.whatsapp_command(text);
drop function public.submission_buffer_config(uuid);
```

Extraction results already written are append-only history; export them before dropping columns if they matter.

## 17. n8n workflows and credentials

| Workflow | Id | State |
| --- | --- | --- |
| VIP Realty — WhatsApp Inbound | `WTSYwWVfuMNK2MeO` | unchanged, inactive |
| VIP Realty — Submission Extraction | `UVGZ9DFDazrRjMup` | inactive; every minute; timeout 180 s; failed executions kept |
| VIP Realty — Property Extraction (AI) | `8aio0xvSzSE4PWCV` | sub-workflow; callable only by Submission Extraction; timeout 120 s |

Pending owner configuration: `VIP Realty Supabase (service role)` credential on the four HTTP nodes (and on the
inbound workflow), Meta credentials, real agency/agent rows, then activation (inbound first, then extraction).
Throughput: one session per minute (~60/hour); increasing the schedule is safe because claiming is atomic.

## 18. Known limitations

- The AI title/description are suggestions; Phase 6 should prefer a deterministic title from validated fields.
- Semantic guards cover intent, country (Armenia), city and correction wording; other normalized values are backed only
  by verbatim evidence and ranges. Evidence proves the quote exists, not that the conversion is right (e.g. unit maths).
- A photo delivered after `done` *and* after the 90-second settle window starts a new session.
- `attempt_number` restarts at 1 after an explicit reprocess (attempts stay distinguishable by `attempt_id` and time).
- Images are not analysed (metadata only).

## 19. Deliberately deferred (Phase 6+)

Property creation/update from `valid` extraction results (idempotent via `properties.created_from_session_id`),
review/approval before publishing, publishing, sold/rented/status commands, media download to the private bucket and
`property_images`, WhatsApp replies/acknowledgements to agents, admin screens for sessions/extractions/inquiries,
notifications/alerts, production WhatsApp activation, deployment and domain.
