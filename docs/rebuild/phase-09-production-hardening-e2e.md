# Phase 9 — Production Hardening and E2E Readiness

> Not a feature phase. Goal: make what exists safe to operate, verify every integration that *can* be verified with
> the credentials that actually exist, and make the rest an explicit, checkable launch gate.
>
> **Credential reality at the time of this phase (checked, not assumed):**
> `SUPABASE_SERVICE_ROLE_KEY` is **not** configured locally · `SUPABASE_PUBLISHABLE_KEY` is not in `.env.local` ·
> n8n holds **0 credentials** · all 4 VIP Realty workflows are **inactive** · no Meta app / access token exists.
> Everything that needs those is **BLOCKED** below and was not simulated as live.

## 1. Production architecture verification

```
Browser ──► Next.js (Vercel-style Node runtime)
            ├─ public pages / inquiry  ── publishable key (server-side only) ──► Supabase: published_property_listings,
            │                                                                   submit_inquiry (RLS, least privilege)
            └─ /admin (session cookie) ── service role (server-only module) ──► Supabase: admin_* views/functions
Meta WhatsApp Cloud API ──► n8n "WhatsApp Inbound" (Meta app credential) ──► ingest_whatsapp_message
n8n schedulers (Submission Extraction, Media Processing) ── Supabase service role credential ──► claim/record functions
n8n "Property Extraction (AI)" ── Anthropic credential ──► raw JSON, validated in the database
```

Verified in this phase:

- Only `lib/env.ts` reads secrets; it and `lib/supabase/admin.ts` import `server-only` (importing them from a client
  component is a build error). The client bundle was scanned after `next build`: 35 files, **0** hits for secret
  names, `service_role`, JWT/`sb_secret_` shapes, admin/diagnostic identifiers, and **0** matches for the actual
  local secret values (compared in memory, never printed).
- Every privileged database object is `service_role`-only (`anon`/`authenticated` have no execute/select); the only
  anonymous surfaces are `published_property_listings` (select) and `submit_inquiry` (execute, `SECURITY DEFINER`,
  intentional — Phase 3). Verified over REST with the publishable key: admin RPC/views → 401, published view → 200.
- n8n exports in `automation/n8n/` reference credentials **by name only**, point at this Supabase project, contain no
  hard-coded token, and are inactive (checked by `npm run test:config`).
- The website has **no** Meta/WhatsApp or Anthropic secret at all; those exist only as n8n credentials.

## 2. Environment variables

| Variable | Scope | Required | Purpose |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | public (bundled) | yes | Supabase project URL |
| `SUPABASE_PUBLISHABLE_KEY` | server | yes | RLS-limited public reads and inquiries |
| `SUPABASE_SERVICE_ROLE_KEY` | server secret | production (dev: warning) | admin area only |
| `ADMIN_SESSION_SECRET` | server secret | yes (32+ chars) | signs admin sessions |
| `ADMIN_PASSWORD_HASH` | server secret | production | scrypt hash of the admin password (`npm run admin:hash-password`) |
| `ADMIN_PASSWORD` | server secret | never in production | local development only; **ignored** when `NODE_ENV=production` |
| `N8N_API_URL`, `N8N_API_KEY` | operator shell only | only for `check:config -- --n8n` | read-only live workflow check; never deployed |

Removed from `.env.example` and flagged by the checker if still set: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`,
`CRON_SECRET`, `NEXT_PUBLIC_SITE_URL` (booking era, no code reads them).
*(Superseded in Phase 10: `NEXT_PUBLIC_SITE_URL` is used again, for page metadata, and is production-required.)*

`.gitignore` now ignores **every** `.env*` file except `.env.example` (previously `.env.production` /
`.env.development` were not ignored). `.env.example` contains placeholders only, grouped public / server / secret.

### Configuration check (`scripts/config/`)

```bash
npm run check:config                          # development profile
npm run check:config:production               # release gate: --production --workflows, exits 1 on any error
npm run check:config -- --production --workflows --n8n   # plus the LIVE n8n instance (needs N8N_API_URL/N8N_API_KEY)
npm run check:config -- --production --no-dotenv         # CI: only platform-injected variables
```

Prints **names and states, never values**; distinguishes required / prod-only / optional; decodes JWT-shaped keys'
*claims* only (never the key) to catch a service key used as the publishable key, keys from another project, or a
publishable key used as the service key; errors on any `NEXT_PUBLIC_*` variable that looks like or contains a secret;
production refuses plaintext passwords, short session secrets and malformed hashes. Workflow checks: activation
(error unless `--allow-active`), wrong Supabase project, hard-coded tokens, credential-requiring nodes without a
credential, credentials referenced but missing in n8n. With `--n8n` but no API key it prints **BLOCKED** (and fails
in production). Meta configuration lives in n8n credentials (checked by name with `--n8n`) and in
`agencies.whatsapp_phone_number_id` (shown on `/admin/operations`).

Current local result: `RESULT: FAIL` — `SUPABASE_PUBLISHABLE_KEY` missing (true), warnings for the missing service
key, the short development `ADMIN_PASSWORD` and the four unused legacy variables. This is the correct answer.

## 3. Credential requirements

| Credential | Where it lives | Exists now | Unblocks |
| --- | --- | --- | --- |
| Supabase publishable key | hosting env `SUPABASE_PUBLISHABLE_KEY` | exists in Supabase, not in `.env.local` | public site in any environment |
| Supabase service role key | hosting env `SUPABASE_SERVICE_ROLE_KEY` | **no** (local) | admin area against live data |
| Admin password hash + session secret | hosting env | no production values yet | admin sign-in in production |
| `VIP Realty Supabase (service role)` (`supabaseApi`) | n8n credential | **no** | every workflow's database calls |
| `VIP Realty WhatsApp (Meta app)` (`whatsAppTriggerApi`) | n8n credential | **no** | inbound webhook (signature verification) |
| `VIP Realty WhatsApp Cloud API (access token)` (`whatsAppApi`) | n8n credential | **no** | media download (and any future outbound) |
| Anthropic (n8n-managed) | n8n credential | **no** | AI extraction |
| Agency row with `whatsapp_phone_number_id` + agents with BSUID/phone | database | **no** (0 agencies) | routing of any inbound message |

## 4. Activation checklist (explicit operator gate)

Nothing activates automatically: n8n never activates a workflow on its own, `check:config:production` **fails** if any
VIP Realty workflow is active (unless the operator passes `--allow-active` after completing this list), and
`/admin/operations` shows routing readiness. The full, ordered list is in
[production-launch-checklist.md](production-launch-checklist.md). Safety behaviours required before activation and
where each is enforced:

| Required behaviour | Mechanism | Evidence |
| --- | --- | --- |
| missing credentials ⇒ stays inactive | n8n cannot activate a trigger without its credential; checker warns per node | live: 0 credentials, 4 inactive |
| wrong environment/project ⇒ stays inactive | checker errors when a workflow URL points at another Supabase project; keys' `ref` claim checked | `test:config` |
| no registered agent ⇒ stored, no property mutation | `ingest_whatsapp_message` → `unresolved_sender`, no session | Phase 9 DB #3, #25 |
| invalid/untrusted sender ⇒ no mutation | same; group messages ignored (Phase 6.5) | Phase 6.5, Phase 9 DB #25 |
| provider error ⇒ retry | media: `record_media_failure` with backoff (60 s base, 1 h max, 6 attempts) | Phase 7 tests |
| expired media ⇒ no repeated download | 7-day `download_deadline_at`; expired media never re-claimed | Phase 7 tests |
| malformed AI ⇒ bounded retry/failure | database validation; `max_extraction_attempts` 3 then `failed` | Phase 5 tests |
| cross-agent / cross-agency ⇒ rejected | ownership in `apply_whatsapp_status_command`, `property_images_provenance_guard`, publication check | Phase 9 DB #23–#24, Phase 7/8 |
| duplicate webhook ⇒ idempotent | unique `(provider, provider_message_id)`; duplicate returns the stored outcome | Phase 9 DB #2, #27 |
| stale lease ⇒ recoverable | `advance_media_pipeline` / `advance_submission_sessions` expire leases; late writes are no-ops | Phase 9 DB #9–#11 |
| retry budget exhausted ⇒ visible | media `failed`, sessions `failed`, `automation_events` warnings/errors | `/admin/operations`, `/admin/pipeline` |

## 5. Admin E2E result

| Part | Result |
| --- | --- |
| Authenticated admin flow against **live admin data** (queue → review → publish in the UI) | **BLOCKED** — no `SUPABASE_SERVICE_ROLE_KEY`. Not claimed. |
| Admin authentication in a **production build** (`next build` + `next start`, `NODE_ENV=production`) with **throwaway** `zz-phase9-test` credentials passed only as process environment (not written to the repo or `.env.local`) | **LIVE, 31/31 checks** (§12 H) |
| The database functions behind every admin action (review, publish, set status) with the same arguments the server actions send | **LIVE** in the database via SQL (§12 F) |
| Admin pages without a service key | render and say "Not configured" (verified) — no fake data |

## 6. n8n ↔ Supabase E2E result

**BLOCKED.** n8n holds 0 credentials, so no workflow can reach Supabase. Not simulated. Live metadata checked: the 4
workflows exist, are inactive, and none was edited after its export was committed (live `updatedAt` vs export commit
time: Media Processing 00:48 < 01:01; Property Extraction (AI) 21:51 < 21:55; Submission Extraction 12:34 < 12:40;
WhatsApp Inbound 13:33 < 13:36, +04:00). Full node-by-node comparison needs the n8n API key (`check:config -- --n8n`),
so the content comparison is CODE-REVIEWED from the exports, not LIVE.

Exact steps once the credential exists: create `VIP Realty Supabase (service role)` → `check:config -- --production
--workflows --n8n` (no "does not exist" warning) → run **Submission Extraction manually once** (not activate) with no
ready sessions → expect `advance_submission_sessions` + `claim_submission_session` → `{claimed:false}` and a
`session.*`-free, error-free execution → then one `zz-phase9-test` session end to end.

## 7. Meta / WhatsApp E2E result

**BLOCKED** — no Meta app, no access token, no WhatsApp Business number configured. Workflows stay inactive. Not
simulated. What *was* tested instead is labelled accordingly: ingestion, commands and media state machine with
**normalized Cloud-API-shaped events** called directly in the database (MOCKED provider, LIVE database).

Exact blocked steps: (1) create the Meta app + WhatsApp Business number; (2) create both WhatsApp credentials in n8n;
(3) insert the agency with its `whatsapp_phone_number_id` and register agents (BSUID and/or phone); (4) activate
**only** WhatsApp Inbound, subscribe the webhook in Meta, send one text from a registered test agent → one
`whatsapp_messages` row, one session, no property; (5) send the same from an unregistered number → `unresolved_sender`;
(6) send a photo → `whatsapp_media` `received`; (7) run Media Processing manually → object in private `whatsapp-media`,
`validated`, then attached once a draft exists. Real binary upload to Storage has **not** happened in any phase.

## 8. Outbound messaging status

**Not implemented, inactive — intentionally.** No outbound credential exists (`whatsAppApi` missing), so an outbound
layer could not be tested, and Phase 8's rule stands: no fake success. Status-command outcomes already carry a
deterministic `reply_text` (e.g. `Done: <slug> is now sold.` / `Not applied: no listing of yours matches that
reference.`) stored in the ingestion result. Activation prerequisites for a future acknowledgement step: the
`whatsAppApi` credential; a Meta-approved template or an open 24-hour customer-service window with the agent; sending
only from the committed ingestion result (never before the transaction commits); idempotency keyed on the inbound
`whatsapp_messages.id` (e.g. an `outbound_sent_at` column set in the same statement that claims the send) so n8n
retries cannot double-send; replies only to the sender of that message.

## 9. Observability

New: `public.admin_operations_status()` (migration `20260919170806_operations_status.sql`, `SECURITY INVOKER`,
`service_role` only, read-only) and **`/admin/operations`** (nav: Operations). One snapshot of:

- website configuration (booleans only: public DB, admin DB, hashed vs development password, production build);
- routing readiness (agencies with a WhatsApp number id, active agents with an identity);
- "needs attention": failed messages, unregistered senders, sessions ready > 15 min or processing > 15 min, failed
  extractions (24 h), held/failed media, expired leases, media past the download deadline, error events (24 h);
- inbound (last message received), sessions, extractions, media, listings (pending review excluding the legacy drafts
  without an agency, approved-not-published, publicly visible), inquiries, status commands (7 days), events by
  severity, Storage object counts;
- the last 25 warnings/errors (7 days): id, event type, severity, source, time, session/property link and a `reason`
  **only if it is a short machine code**.

It never returns message text, raw payloads, phone numbers, BSUIDs, Storage paths or credentials (tested: output
contains no fixture text, BSUID, wamid or agent name; problem keys are exactly
`created_at,event_type,id,property_id,reason,session_id,severity,source`). It cannot see n8n activation, n8n
credentials or Meta delivery — the page says so and points to `check:config -- --n8n`.

Logs: server logs carry an operation label and a database error **code** (plus the PostgREST message for read failures
in `lib/admin/properties.ts` / `lib/listings/queries.ts`). No request bodies, passwords, cookies, tokens, phone numbers
or payloads are logged anywhere in the app (`grep console.` audit: 12 call sites). Traceability uses safe references
already in the data model: `automation_events.id`, `correlation_id`, `session_id`, `property_id`, event type and stage.

## 10. Security hardening

### Admin authentication (shared-password model, hardened)

| Topic | Before | Now |
| --- | --- | --- |
| Password storage | plaintext env var compared at runtime | **scrypt** hash `scrypt:N:r:p:salt:key` (N=16384, r=8, p=1, 16-byte salt, 32-byte key), `npm run admin:hash-password` reads stdin; plaintext accepted **only outside production**. `:` separators because `.env` loaders expand `$` (verified: a `$`-separated hash in a `.env` file arrives mangled, even single-quoted) |
| Fail closed | — | production sign-in disabled (503, generic message) unless a valid hash **and** a 32+ char secret exist; verified: production with only `.env.local` → 503; malformed hash → 503 |
| Cookie | `vip_admin`, HttpOnly, SameSite=Lax | production: `__Host-vip_admin` (Secure, Path=/, no Domain), HttpOnly, SameSite=Lax, 12 h |
| Expiry | 12 h | 12 h absolute; future-dated tokens refused (60 s skew); token length capped |
| Session invalidation | secret rotation | signing key = `ADMIN_SESSION_SECRET` + credential fingerprint → rotating **either** the secret **or** the password signs everyone out |
| CSRF | SameSite only | login/logout refuse `Sec-Fetch-Site: cross-site`, `Origin: null` and foreign `Origin` (403); server actions keep Next.js's Origin check |
| Brute force | 5/min per IP | 5/min per client address **plus** a global 30/min ceiling (holds even with rotated `X-Forwarded-For`); fixed 500 ms delay on failure; 2 KB body cap; 1024-char password cap |
| Logging | none | still none: attempts are never logged |

Limits (documented, not hidden): one shared credential — no per-person identity (audit uses a one-way session
reference); logout clears only the current browser (a copied cookie lives until expiry unless the secret/password is
rotated); the limiter is in-memory per instance (resets on deploy, not shared across instances); the global ceiling
means an attacker can keep admin sign-in locked while attacking (sign-in resumes a minute after it stops) — put an edge
rate limiter/WAF in front for real exposure; `X-Forwarded-For` is trusted as set by the hosting proxy.

### Rate limiting and abuse review

| Endpoint | Limits | Validation / size | Idempotency / replay | Errors |
| --- | --- | --- | --- | --- |
| `POST /api/admin/login` | 5/min/IP + 30/min global, 500 ms failure delay | 2 KB body, JSON, password ≤ 1024 | n/a | generic 401/403/429/503, `no-store` |
| `POST /api/admin/logout` | — | same-origin check | idempotent | 403 on cross-site |
| `POST /api/inquiries` | 5/min/IP + database-side rate limit | 10 KB body, schema validation, honeypot | `submissionId` dedupe in the database | generic messages; DB errors logged by code only |
| `GET /api/admin/images/...` | admin session required | UUID + kind allow-list, lookup by id | read-only | 401/404, `private, no-store`, `nosniff`, sandbox CSP |
| Public listing pages | framework | slug lookup through the published view only | read-only | 404 for anything unpublished |
| Meta webhook (n8n) | **no limit added** — Meta delivers legitimate bursts (albums, retries) and there is no evidence of abuse; protection is Meta's signature check in the WhatsApp Trigger credential plus idempotent ingestion | normalized payload, bounded fields | unique provider message id | nothing echoed back |

Supabase requests from the website time out (admin 8 s, public bounded) so a slow database cannot hang a request.

### Error/leakage audit

Checked that no response or log contains: service-role or Meta tokens (none exist in the website; bundle scan clean),
raw WhatsApp payloads (never selected by the website; diagnostics exclude them), sender phone numbers/BSUIDs (never
selected; public page scanned for the fixture BSUID, session/extraction/attempt ids, `review_note`, `state_version`,
`raw_payload`, `service_role` — none), database credentials (none in the website). Next.js production errors render a
generic page. Status-command replies never reveal other agents' listings (same reply for "not yours" and "not found").

## 11. Draft-image exposure status

**Residual risk, unchanged, documented — no partial fix.** Draft gallery copies are written to the public-object bucket
`property-images` at `properties/{property_id}/{media_id}.{ext}` (Phase 7). The admin no longer uses public URLs
(Phase 8 authenticated proxy). What remains: someone who already knows the exact URL (two random UUIDs, never
disclosed, not listable — bucket listing is denied) can fetch a draft photo, and photos of sold/archived listings stay
reachable at their URL. Currently **0** objects exist in Storage, so nothing is exposed today.

Why it is not closed in this phase: closing it means publication has to copy objects between buckets through the
Storage API (the database cannot copy objects), which turns publish into a two-system operation, changes the Phase 7
n8n attach workflow, and cannot be tested end to end without the service key and a real binary upload (neither
exists). A fragile migration would be worse than the documented, currently empty exposure.

**Smallest safe migration path (reversible, non-destructive):**
1. Create a **private** bucket `property-images-draft` (no public read; service role only).
2. Add `property_images.storage_bucket text not null default 'property-images'` (existing rows keep working) and
   point `media_target_path`/the n8n attach step at the draft bucket for new drafts.
3. Publish becomes: server action (service role) **copies** each draft object to `property-images` via the Storage
   API → a database function verifies every copy exists (`media_storage_object_size`) and, in one transaction,
   switches `storage_bucket` and publishes (refusing if any copy is missing). A failed copy leaves the draft
   unpublished; retrying is idempotent (same target paths).
4. `published_property_listings` builds URLs only for rows in the public bucket.
5. Optional: on archive, remove public copies (keep the draft copy for restore).
6. Rollback: point writes back at `property-images`; the column default keeps old rows valid; no object is deleted.

## 12. Test matrix

LIVE = executed against the real system named · MOCKED = a stand-in replaced a real dependency (named) ·
CODE-REVIEWED = verified by reading/static checks · BLOCKED = needs a credential that does not exist.

| # | Test | Label | Result |
| --- | --- | --- | --- |
| A | TypeScript `tsc --noEmit` | LIVE | PASS |
| B | ESLint | LIVE | PASS |
| C | Production build (`next build`) | LIVE | PASS (15 routes incl. `/admin/operations`) |
| D | Media tests `npm run test:media` | LIVE | 11/11 PASS |
| E | Parser tests `supabase/tests/whatsapp_status_command.test.sql` | LIVE (database) | 22/22 PASS |
| F | Database lifecycle: ingest → session → claim → extraction → draft → review → publish → status → public view | LIVE database, **MOCKED provider events and MOCKED AI output** (canned Phase 8 outputs, model `zz-phase9-test-canned-output`) | 30/30 assertions PASS (below) |
| G | Public route safety (production build, publishable key at runtime) | LIVE (local production server, live Supabase) | 14/14 HTTP + 4/4 anonymous REST PASS |
| H | Admin authorization (production build, throwaway credentials) | LIVE (auth layer) — admin data **BLOCKED** | 31/31 + fail-closed 1/1 PASS |
| I | Configuration validation `npm run test:config` + CLI run | LIVE | 8/8 PASS; CLI correctly FAILs locally (missing publishable key) |
| J | n8n structure/drift | exports: LIVE (`test:config`); live instance: LIVE metadata (4 inactive, 0 credentials, no edit after export); node-level diff: CODE-REVIEWED | PASS |
| K | Duplicate webhook | LIVE database, MOCKED provider | PASS (text and command) |
| L | Retry / lease recovery | LIVE database (lease expiry time-travelled) | PASS |
| M | Cross-agent isolation | LIVE database | PASS |
| N | Cross-agency isolation | LIVE database | PASS |
| O | Stale mutation protection | LIVE database | PASS (3 cases) |
| P | Secret scan (repo tracked+untracked, client bundle, server logs) | LIVE | PASS — 0 credentials; one synthetic test string rewritten so scanners don't flag it |
| Q | Supabase security advisors | LIVE | no new findings (known: RLS-no-policy INFO on service-only tables — intentional; `submit_inquiry` anon definer — intentional; Auth leaked-password protection — Supabase Auth unused) |
| R | Real n8n → Supabase | BLOCKED | no n8n credential |
| S | Real Meta → n8n | BLOCKED | no Meta credentials |
| T | Real media download | BLOCKED | no `whatsAppApi` credential |
| U | Real Storage upload | BLOCKED | no service key in n8n; **no real binary upload has ever happened** |
| V | Real draft generation (real AI) | BLOCKED | no Anthropic credential; database draft generation itself is LIVE in F |
| W | Real admin review → publish (UI) | BLOCKED | no service key; the functions are LIVE in F |
| X | Real status command over WhatsApp | BLOCKED | no Meta; the command path is LIVE in F with normalized events |
| Y | Real outbound acknowledgement | BLOCKED / not implemented | §8 |

**F/K/L/M/N/O — database assertions (fixtures `zz-phase9-test`, agencies A and B, agents A1, A2, B1):**
1 text stored, session created · 2 same webhook again → `duplicate`, same message, `delivery_count` 2 ·
3 unregistered sender → `unresolved_sender`, no session · 4 agency B text in its own session · 5 photo → media row ·
6–7 `done` → sessions `ready` (`done_command`) · 8 download claim → lease, attempt 1 · 9 diagnostics flag the expired
lease · 10 sweep recovers it → `received`, `retry_scheduled`, next attempt in the future · 11 late completion from the
"crashed" worker → no-op, still `received` · 12 both sessions claimed · 13 canned outputs recorded, validation `valid`
· 14 two drafts (`draft` / `pending`) · 15 publish before approval → `blocked: not_approved` · 16 approve → v2 ·
17 approve again with the old version → `already` · 18 publish with the old version → `stale` · 19 publish → v3, in
the public view · 20 publish again → `already`, exactly one `property.published` event · 21 approve B · 22 publish B
with a pending photo → `blocked: media_processing` · 23 agency B agent sends `sold <A's slug>` → rejected,
unchanged · 24 same-agency other agent → rejected (same reply), unchanged · 25 unregistered sender → never reaches
commands, unchanged · 26 owner → `sold`, v4, gone from the public view · 27 duplicate command webhook → `duplicate`,
exactly one `property.status_changed` · 28 admin archive with the pre-command version → `stale` · 29 diagnostics
contain no payload/text/BSUID/names · 30 `admin_operations_status` executable by `service_role` only (anon REST 401).

**G — public (HTTP):** index 200 and lists the published fixture · listing page 200 with call link · no internal ids ·
approved draft 404 · `/book`, `/viewings`, `/api/bookings` 404 · no booking text · inquiry for published 201 · for a
draft 409 · after `sold`: page 404 and absent from the index. **REST (publishable key):** `admin_operations_status`
401 · scratch table 401 · `admin_property_review` 401 · published view 200.

**H — admin (HTTP, production mode):** protected pages 307 without session · image proxy 401 without session · login
with foreign `Origin` 403 · with `Sec-Fetch-Site: cross-site` 403 · wrong password 401 after ≥ 500 ms · oversized
body 401 · correct password 200 · cookie `__Host-vip_admin`, HttpOnly, Secure, SameSite=Lax, Path=/, Max-Age 43200,
no Domain · `no-store` · operations page with session 200 and honest "Not configured" · image proxy with session but
no service key → not served · forged signature 307 · development cookie name ignored 307 · freshly signed token
accepted (model check) · 13-hour-old token 307 · future-dated token 307 · token signed with an old secret 307 · logout
cross-site 403 · logout clears the cookie · 6th attempt from one address 429 · global ceiling holds with 30 rotated
addresses · correct password refused while limited 429. Plus: production with only `.env.local` (plaintext
password) → 503. (A first run with an incorrectly quoted hash in the test harness returned 503 for every sign-in —
itself a confirmation that a malformed hash fails closed. It also exposed that `$` in the hash is expanded by `.env`
loaders, so the format was changed to `:` separators and every affected test was rerun.)

**Test-only manipulations (disclosed):** `lease_expires_at` moved into the past for one fixture media row;
`process_after` moved to now for the two fixture sessions (skips the 90 s media-settle wait); a temporary
service-role-only table `public.zz9` (RLS on, no anon/authenticated grants) held step results and was dropped.

## 13. Data preservation

After cleanup: agencies, agents, messages, media, sessions, extraction results, property images, inquiries,
automation events, Storage objects, published listings **all 0**; `zz9` dropped; no `zz` rows anywhere. Legacy six
properties: original-column fingerprint `dd176f3228bfbd3db47acffcd68ed2eb` (unchanged since Phase 6.5),
`state_version` 1, last update 2026-09-12. RSVP: 1 row, `090be351634e3e9aebe9752e33ec3dee` (unchanged). Booking:
no viewing tables, `/book` `/viewings` `/api/bookings` 404, no booking text. No workflow activated; no Meta message
sent; no production data used.

## 14. Rollback procedure

| What | Procedure |
| --- | --- |
| Next.js deployment | Promote the previous deployment in the hosting platform (instant) or `git revert <sha>` and redeploy. Env changes: restore the previous values; rotating `ADMIN_SESSION_SECRET` or the password hash signs every admin out (intended). |
| This phase's migration | `drop function public.admin_operations_status();` — read-only function, nothing depends on it except `/admin/operations` (which then shows "Temporarily unavailable"). |
| Any migration release | Before release: `supabase db dump` (schema) and confirm a fresh daily backup / PITR point. Prefer a forward fix; each phase document lists its own rollback SQL (Phase 8 §17, Phase 7, …). No destructive down-migrations were added for appearance. |
| n8n workflow release | `automation/n8n/*.json` are the source of truth (credentials by name). Deactivate → restore the previous version (n8n version history or re-import the committed export) → verify with `check:config -- --production --workflows --n8n` → reactivate per checklist. |
| Activation / emergency stop | Deactivate **WhatsApp Inbound first** (stops intake; Meta retries undelivered webhooks for a limited time, then drops them), then Submission Extraction, then Media Processing. Everything already stored stays; leases expire and are recovered on reactivation. |
| Status commands | A wrong status change is reversed in the admin (restore / mark published again). To disable commands entirely, redeploy the Phase 6.5 `ingest_whatsapp_message` (Phase 8 §17) — commands then become ordinary text. |

## 15. Exact blockers

1. `SUPABASE_SERVICE_ROLE_KEY` in the website environment (admin E2E, W).
2. `SUPABASE_PUBLISHABLE_KEY` in the website environment (currently only passed at test time).
3. Production `ADMIN_PASSWORD_HASH` + `ADMIN_SESSION_SECRET` (sign-in is disabled in production without them).
4. n8n credentials: `VIP Realty Supabase (service role)`, `VIP Realty WhatsApp (Meta app)`,
   `VIP Realty WhatsApp Cloud API (access token)`, Anthropic (R, S, T, U, V).
5. Meta app, WhatsApp Business number, webhook subscription (S, X).
6. Real agency and agent registrations (routing).
7. Real contact details in `lib/site.ts` (currently placeholders `+37400000000`) and real media/statistics
   (`MEDIA_IS_PLACEHOLDER`).
8. Outbound acknowledgements: not implemented (Y).

## 16. Known limitations

- Shared admin password (no per-person accounts); limiter per instance; global ceiling can be used to delay admin
  sign-in (§10).
- Draft images reachable by exact URL once they exist (§11).
- n8n content drift is verified by timestamps and exports, not a live node-level diff, until an n8n API key is set.
- AI extraction, Meta delivery, media download and Storage upload have never run for real.
- Parallel races verified by design (row locks + versions), not by a concurrent-connection test.
- `admin_operations_status` was refined once (the legacy-draft counter restricted to pending drafts) with
  `create or replace` before commit; the committed file is byte-identical to the deployed function body (md5 checked).
