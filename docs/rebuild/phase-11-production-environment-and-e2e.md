# Phase 11 — Production Environment Separation and E2E Integration

Status: **PASS WITH LIMITATION.** The dedicated realty Supabase project exists, carries the complete realty schema
(verified object-for-object against the old project) and the only realty data there was (the 6 legacy drafts,
byte-identical). The application and the n8n exports now target it, and the config gate refuses the shared project.
**Every live integration step (n8n credentials, Meta, webhook, real AI, real media, real Storage upload, signed-in admin
E2E, WhatsApp status command, outbound) is BLOCKED**: no production credential was supplied ("None right now"), and none
was simulated. All workflows remain **inactive**. Nothing was activated.

## 1. Environment audit (before changes)

| Item | Finding |
| --- | --- |
| Supabase project used by realty | `muqfjbkeyvvfvlodzujs` (shared) |
| Shared with the RSVP app? | **Yes** — `public.rsvps` (1 row) and its migration `20260906121201_create_rsvps_table` live in the same project |
| Next.js Supabase references | only `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (no hard-coded project in code) |
| n8n exports | 21 hard-coded `https://muqfjbkeyvvfvlodzujs.supabase.co` URLs (Media Processing 14, Submission Extraction 6, WhatsApp Inbound 1); credentials by name only |
| Live n8n (anna2210.app.n8n.cloud) | 4 VIP Realty workflows, **all inactive**; **0 credentials** exist |
| Meta / WhatsApp | no app, number id, token or webhook configured anywhere; `agencies.whatsapp_phone_number_id` unset (no agencies) |
| Local config (`.env.local`, names only) | URL = shared project; `SUPABASE_PUBLISHABLE_KEY` absent; `SUPABASE_SERVICE_ROLE_KEY` empty; plaintext `ADMIN_PASSWORD` (dev), no hash; `NEXT_PUBLIC_SITE_URL` = placeholder domain; legacy `CRON_SECRET` set |
| Agency / site profile | 0 agencies, 0 agents → website shows the working name, no contacts |
| Realty data | 6 legacy draft properties (no agency, never published); 0 images, inquiries, messages, sessions, events, Storage objects |

`.env.local` was not modified. The production config checker now fails on it (see §4), which is the intended result.

## 2. Dedicated Supabase project

| | Old (shared) | New (dedicated realty) |
| --- | --- | --- |
| Ref | `muqfjbkeyvvfvlodzujs` | `vqdxqqsvlkddgkzulaxv` |
| URL | `https://muqfjbkeyvvfvlodzujs.supabase.co` | `https://vqdxqqsvlkddgkzulaxv.supabase.co` |
| Contents | RSVP + realty | realty only (no RSVP table, function or data) |
| Status | **untouched** (read-only queries only); remains the rollback source | schema complete, legacy data migrated, no agency/agent |

### Migration procedure (what was actually run)

The repo's `supabase/migrations/` is the authoritative source. Each file was applied **in order** with the Supabase
`apply_migration` tool, verbatim. Large files were split **at statement boundaries only** (never inside a statement),
so the new project's history has 35 entries for the 28 files. Deviations, all deliberate:

| File | How it was applied | Why |
| --- | --- | --- |
| `20260917141010_remove_booking_system` | adapted (and the repo file is updated to match — see below) | (1) it asserted that `public.rsvps` exists — a shared-project sanity check that is false by design in a dedicated project; (2) `public.notification_events` (the booking outbox created by `viewing_schema`, FK → `viewing_bookings`) blocked `drop table viewing_bookings`. In the old project it had been **dropped outside the migration history** (found by this phase's consistency test A). The migration now drops it with `if exists` after an emptiness guard, so a fresh database converges to the old project's end state. The old project already ran this migration and never re-runs it. |
| `20260918091820_whatsapp_identity_model` | DDL applied; its `ingest_whatsapp_message` body skipped | body superseded by `20260919215136_listing_editing` |
| `20260918092512_whatsapp_identity_session_key` | comments applied; ingest body skipped | same |
| `20260919164215_whatsapp_status_commands` | not applied (the file is only an `ingest_whatsapp_message` body + its grants) | superseded by `listing_editing`, which re-grants identically |
| `20260919170806_operations_status` | body not applied; its `comment on function` applied with `listing_editing` | `admin_operations_status` body superseded by `listing_editing` |
| every other file | verbatim | — |

Skipping superseded intermediate function bodies changes nothing in the end state (`create or replace` of the final
definition); the end state is what was verified.

**Migration history note.** The new project's `supabase_migrations.schema_migrations` records what actually ran (35
entries, their own timestamps). If the Supabase CLI is ever used against it (`supabase db push`), first mark the repo's
28 versions as applied — `supabase migration repair --status applied <version> …` for every file in
`supabase/migrations/` — and `--status reverted` for the 35 tool-applied versions, so the CLI does not re-run history.

### Verification (test A/B, LIVE)

The same fingerprint query ran on both projects (objects whose name matches `rsvp` excluded on the old side):

| Category | Objects | Result |
| --- | --- | --- |
| functions (md5 of every `pg_get_functiondef`) | 63 | identical |
| function grants (ACLs) | 63 | identical |
| columns (type, default, nullability) | 353 | identical |
| constraints | 176 | identical |
| indexes | 66 | identical |
| triggers | 14 | identical |
| views (definitions) | 7 | identical |
| RLS flags | 17 | identical |
| policies (public + storage) | 3 | identical |
| table grants | 21 | identical |
| column grants (anon/authenticated) | 156 | identical |
| Storage buckets (public flag, size limit, MIME list) | 2 | identical |
| function and table/view comments | — | identical |

New project: 10 tables (`agencies, agents, automation_events, extraction_results, inquiries, properties,
property_images, submission_sessions, whatsapp_media, whatsapp_messages`), no RSVP object, no booking object
(`viewing_*`, `notification_events`). Security advisors: the same findings as the old project, no new ones (intentional
public `submit_inquiry`; service-role-only tables without policies). The old project additionally reports leaked-password
protection (Supabase Auth is not used by this app).

## 3. Realty data migration

Only realty-owned data existed: the **6 legacy properties** (`atelier-loft`, `cascade-house`, `hillside-land`,
`modern-residence`, `north-avenue-flat`, `panorama-penthouse`). They were copied **byte-for-byte** (all columns,
including ids, slugs, timestamps, legacy columns and `state_version`) with triggers suspended for that single insert so
no lifecycle/timestamp trigger rewrote them. Evidence: md5 of the full JSON of all 6 rows is
`d00e55d09f363660b9ce0806a8b95268` in **both** projects. They remain `draft`, no agency, no review status — the
publication check blocks them (`no_agency`), and they are not editable in the admin (Phase 10). Public listing count: 0.

Not migrated: RSVP data (1 row, stays in the old project), test fixtures (none existed), Storage objects (none existed).
No agency or agent was created — no real values were supplied (§5).

## 4. Environment configuration

The application reads the same three Supabase variables; nothing in code names a project. Switching environments is a
configuration change. New in this phase: **project pinning** in the config gate.

| Variable | Scope | Production |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | public | `https://vqdxqqsvlkddgkzulaxv.supabase.co` |
| `SUPABASE_PROJECT_REF` (new) | server | `vqdxqqsvlkddgkzulaxv` — required; URL (and JWT-format keys) must match it |
| `SUPABASE_PUBLISHABLE_KEY` | server | the new project's publishable key (Dashboard → API keys) |
| `SUPABASE_SERVICE_ROLE_KEY` | server secret | the new project's secret/service-role key — **operator supplies** (no tool can read it) |
| `ADMIN_PASSWORD_HASH` | server secret | `npm run admin:hash-password` |
| `ADMIN_SESSION_SECRET` | server secret | ≥ 32 random chars |
| `NEXT_PUBLIC_SITE_URL` | public | the real https domain |

`npm run check:config:production` now refuses: a URL for a different project than `SUPABASE_PROJECT_REF`; a missing or
malformed pin; the **shared RSVP project** (`SHARED_PROJECT_REFS`) unless it is explicitly pinned (rollback — then a
warning); plus the existing rules (missing variables, a service key in `NEXT_PUBLIC_*` or in the publishable slot,
cross-project JWT keys, placeholder site URL, placeholder contacts via `--site`, plaintext/short admin secrets, n8n
exports pointing at another project or holding hard-coded tokens). Values are never printed.

Evidence (LIVE): against today's `.env.local` the production gate reports `RESULT: FAIL` (missing pin, shared
project, missing publishable/service keys, missing hash, placeholder site URL, and every n8n node pointing at another
project). Against the new project's public values (`--site --workflows`, development profile) it reports
`OK with warnings` (no service key, no admin secrets, no site agency).

`.env.production` does not exist and is not committed; `.env.local` is unchanged.

## 5. Agency and agent setup — not configured (no real values)

No brand name, phone, WhatsApp number, e-mail, address, agent name, BSUID or Meta `phone_number_id` was supplied, so
none was entered. The new project has 0 agencies and 0 agents; the website shows the working name `VIP Realty` without
contacts; `/admin/operations` reports "site profile not configured" and zero routing readiness. Activation is blocked on
this (§12). Procedure once values exist: Production launch checklist §1 and §3 (`/admin/agency`, `/admin/agents`,
identities linked from real first messages only).

## 6. n8n — exports repointed, credentials BLOCKED

* Committed exports (`automation/n8n/*.json`): the 21 Supabase URLs now point to `vqdxqqsvlkddgkzulaxv`; no other
  change; no credential values in any export (scan §14).
* Live n8n workflows: **unchanged and inactive**, still pointing at the old project. This is deliberate: they have no
  credentials and cannot run; with the production environment pointed at the new project,
  `check:config -- --production --workflows --n8n` reports every live node as "points to a different Supabase project"
  and fails, so they cannot be activated by mistake. The operator re-imports the committed exports when creating the
  credentials (same names).
* Credentials required (created in n8n, referenced by name): `VIP Realty Supabase (service role)` (supabaseApi, new
  project), `VIP Realty WhatsApp (Meta app)` (whatsAppTriggerApi), `VIP Realty WhatsApp Cloud API (access token)`
  (whatsAppApi); the AI sub-workflow uses the n8n-managed Anthropic gateway credit.
* Connectivity test with `zz-phase11-test` data: **BLOCKED** (no Supabase service-role credential in n8n).

## 7. Meta / WhatsApp — BLOCKED

Required and not available: a Meta app with WhatsApp Business, the production business phone number and its
`phone_number_id`, a system-user access token, the app secret/verify token for the trigger credential, and the public
n8n webhook URL subscribed to `messages`. The production channel is the **direct** WhatsApp Business number; the old
WhatsApp group is not connected and no historical group migration exists (group messages are stored and ignored).

## 8–14. Webhook, real E2E, media, AI, admin, status command, outbound — BLOCKED

Nothing in these parts was run, simulated or described as done. Exact prerequisites and the run order are in the
launch checklist §4–§7. Specific notes:

* **Webhook (Part 8):** needs the Meta app + an active WhatsApp Inbound workflow. Database-side behaviour already
  covered by tests on the new project: duplicate delivery idempotency, malformed payload rejection, unknown sender stored
  without mutation, inactive agency stored as `agency_inactive` (test J).
* **E2E listing (Part 9):** use a dedicated test agent and a `zz-`/`E2E PHASE 11 TEST` labelled text; the listing must
  stay unpublished or be removed immediately after verification (checklist §5 cleanup).
* **Media (Part 10) / Storage:** 0 objects exist in both buckets; **no Storage upload was performed** — no service key.
* **AI (Part 11):** no model was invoked in this phase — not LIVE, not MOCKED; it was not run.
* **Admin (Part 12):** unauthenticated behaviour verified live (redirect to `/admin/login`); a signed-in session needs
  the service key and a password hash for the new project.
* **Status command (Part 13):** database path verified on the new project with synthetic agents (test J); the real
  WhatsApp path needs Meta.
* **Outbound (Part 14):** not implemented. The acknowledgement text is already produced and audited by the database
  (`reply_text` in `apply_whatsapp_status_command`), but no send is possible without a Cloud API token, and replies
  outside the 24-hour customer-service window require an approved message template. Outbound stays inactive.

## 15. Draft-image security decision

**Unchanged: the authenticated admin proxy stays; the residual risk stays documented (Phase 9 §11); no bucket split.**
The split requires publish to copy objects through the Storage API and changes the n8n attach step; neither can be
tested without the service key and a real upload, and an untested migration of the image path is exactly what the brief
forbids. In the new project both buckets are empty, so nothing is exposed today. The reversible migration path in
Phase 9 §11 remains the plan; it should be done before the first real listing photos arrive, once E2E is possible.

## 16. Activation gate — NOT met; all workflows inactive

| Requirement | State |
| --- | --- |
| Dedicated Supabase project | ✅ `vqdxqqsvlkddgkzulaxv` |
| Correct Supabase credentials in the app | ❌ service key not supplied |
| Production site URL | ❌ placeholder |
| Real brand / contact configuration | ❌ none |
| Real agency, active agents | ❌ none |
| Meta credentials, verified webhook | ❌ none |
| n8n credentials | ❌ none (0 in n8n) |
| E2E, media upload, admin publish, status command | ❌ not possible yet |
| Rollback documented | ✅ §18 |

| Workflow | State |
| --- | --- |
| VIP Realty — WhatsApp Inbound | inactive |
| VIP Realty — Submission Extraction | inactive |
| VIP Realty — Property Extraction (AI) | inactive |
| VIP Realty — Media Processing | inactive |

## 17. Monitoring after activation

Not applicable (no activation). The smoke test to run after an explicit activation is the launch checklist §7.

## 18. Rollback

| Layer | Procedure |
| --- | --- |
| Application | Restore the previous env values (URL/keys of `muqfjbkeyvvfvlodzujs`) **and** set `SUPABASE_PROJECT_REF=muqfjbkeyvvfvlodzujs` (explicit pin — the gate then accepts the shared project with a warning), redeploy; or promote the previous deployment. |
| Supabase | Stop using the new project (no DNS/data dependency on it). The old project is untouched and remains the rollback source — **do not delete it** until the new environment has run stably in production. Nothing was copied back; the legacy rows exist unchanged in both. |
| n8n | Workflows are inactive. To revert the exports: `git revert` this commit's `automation/n8n` change (or keep the live workflows, which still point at the old project). |
| Meta | Nothing was configured; if a webhook is later subscribed, unsubscribe it / deactivate WhatsApp Inbound first. |
| Repo migration edit | The `remove_booking_system` change only affects fresh databases; reverting the file restores the original text (which cannot replay on a project without `rsvps`). |
| New project itself | Can be paused or deleted by the operator without affecting the old one (it holds only the schema and 6 copied legacy rows). |

## 19. Test matrix

| # | Test | Label | Evidence |
| --- | --- | --- | --- |
| A | Migration consistency | LIVE | full history replayed on the new project; found out-of-band drift (`notification_events`) and fixed the repo migration |
| B | Schema/object comparison | LIVE | 941 objects in 12 categories + comments identical between projects (§2) |
| C | Config checks | LIVE | 15/15 config tests (2 new: pinning, shared project); gate run against `.env.local` (FAIL, as intended) and against the new project (OK with warnings) |
| D | Typecheck | LIVE | `tsc --noEmit` clean |
| E | Lint | LIVE | `eslint .` clean |
| F | Production build | LIVE | `next build` exit 0 |
| G | Existing unit tests | LIVE | `npm test` 26/26 (media 11, config 15) |
| H | Media tests | MOCKED | 11/11 with synthetic byte fixtures; no real media |
| I | Status parser tests | LIVE | 22/22 cases on the new project's database |
| J | Ownership tests | LIVE | 36/36 (agency/agent/ownership/edit/gallery) + 4/4 (status-command ownership) on the new project, synthetic `zz-` fixtures, self-cleaned |
| K | Public regression | LIVE | site run against the new project: `/` 200, `/properties` 200, legacy slug 404 with no listing content, inquiry validation 400 |
| L | Anonymous REST security | LIVE | 23 probes on the new project: private tables/admin views/admin RPCs 401 (42501), `properties.agency_id` and `agencies.whatsapp_phone_number_id` denied, `rsvps` 404, anon PATCH denied, Storage listing empty |
| M | Admin auth | LIVE | unauthenticated `/admin` → `/admin/login` (signed-in flow: BLOCKED, no admin secrets for the new project) |
| N | Real n8n → Supabase | BLOCKED | no n8n credentials |
| O | Real Meta webhook | BLOCKED | no Meta app/token |
| P | Real WhatsApp identity | BLOCKED | no agent, no Meta |
| Q | Real session creation | BLOCKED | depends on O/P |
| R | Real AI extraction | BLOCKED | depends on Q; not run |
| S | Real media download | BLOCKED | no Meta token |
| T | Real Storage upload | BLOCKED | no service key; 0 objects |
| U | Real property_images insertion | BLOCKED | depends on T |
| V | Real admin review | BLOCKED | no service key/admin secrets for the new project |
| W | Real publish | BLOCKED | depends on V |
| X | Real public listing | BLOCKED | depends on W |
| Y | Real Request More Information | BLOCKED | needs a published listing |
| Z | Real status command | BLOCKED | needs Meta + a published test listing |
| AA | Real outbound acknowledgement | BLOCKED | no token; template policy (§8–14) |

## 20. Cleanup

Test fixtures created on the new project (`zz-phase10-selftest*`, `zz-phase10-cmd*`) were removed by the tests
themselves; afterwards: 0 agencies, 0 agents, 0 messages, 0 sessions, 0 extraction results, 0 events, 0 images,
0 Storage objects, 6 properties (legacy, md5 unchanged). No E2E listing exists or is public; no test identity is
registered; no site-primary agency exists. The old project was not written to.

## 21. Security check

See the Phase 11 report: repo/n8n/browser-bundle secret scans clean; the service-role key and Meta token have no path
to the browser (server-only variables, gate rejects `NEXT_PUBLIC_*` secrets); anonymous read model limited to
`published_property_listings` and `public_site_profile`; draft/review data, raw WhatsApp payloads, BSUIDs and phones
readable only by the service role.

## 22. Remaining blockers (in order)

1. Operator supplies the new project's **service-role key**, a **real https site URL**, an **admin password hash** and a
   **session secret** in the hosting environment, plus `SUPABASE_PROJECT_REF=vqdxqqsvlkddgkzulaxv`.
2. **Real brand and contact values** → agency at `/admin/agency` (site agency).
3. **Meta**: WhatsApp Business app, direct business number, `phone_number_id`, system-user token, webhook verify token.
4. **n8n**: create the three credentials against the new project; re-import the committed exports; checker green.
5. Staged E2E (checklist §5), then the draft-image bucket split (Phase 9 §11) before real listing photos.
6. Explicit, evidence-based activation (checklist §7). Keep the old project until the new one is proven stable.
