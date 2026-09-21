# Production launch checklist

Work top to bottom. Every step is an explicit operator action; nothing here happens automatically. Details and the
reasoning behind each gate: [phase-09-production-hardening-e2e.md](phase-09-production-hardening-e2e.md),
[phase-10-agency-agent-listing-management.md](phase-10-agency-agent-listing-management.md) and
[phase-11-production-environment-and-e2e.md](phase-11-production-environment-and-e2e.md).

Production runs on the **dedicated realty Supabase project `vqdxqqsvlkddgkzulaxv`**. The old project
`muqfjbkeyvvfvlodzujs` is shared with the wedding RSVP app: never point production at it (the config gate refuses it)
and do not delete it — it is the rollback source until the new environment has run stably.

## 1. Brand, contacts and content (blocks public launch)

- [ ] Confirm the **production brand name** with the client. Until it is set the site shows the project working name
      (`VIP Realty`) — that is a launch item, not a chosen brand.
- [ ] Create the agency at **`/admin/agency`** and tick "This is the website agency". Fill in: display name (brand),
      legal name, public phone, public WhatsApp number, public email, office address, opening hours.
      These are the only source of the site's brand and contact details; placeholder-looking values are refused.
- [ ] Real imagery and statistics; set `MEDIA_IS_PLACEHOLDER = false` in `lib/media.ts` (see `README.md`).
- [ ] Real social links in the footer (currently `href="#"` placeholders) or remove them.
- [ ] `npm run check:config -- --site` → the profile is complete with no placeholder values.

## 2. Website configuration (hosting environment, never in Git)

- [ ] `NEXT_PUBLIC_SUPABASE_URL=https://vqdxqqsvlkddgkzulaxv.supabase.co`, `SUPABASE_PROJECT_REF=vqdxqqsvlkddgkzulaxv`,
      `SUPABASE_PUBLISHABLE_KEY` (that project's publishable key).
- [ ] `NEXT_PUBLIC_SITE_URL` — the real https site URL (page metadata); no `*.example` domain.
- [ ] `SUPABASE_SERVICE_ROLE_KEY` — server-only, the **dedicated** project's key (Dashboard → API keys).
- [ ] `ADMIN_PASSWORD_HASH` from `npm run admin:hash-password` (password ≥ 16 chars, stored in a password manager).
- [ ] `ADMIN_SESSION_SECRET` — random, ≥ 32 chars (`openssl rand -base64 48`).
- [ ] No `ADMIN_PASSWORD`, no legacy `TELEGRAM_*` / `CRON_SECRET`, nothing secret under `NEXT_PUBLIC_`.
- [ ] `npm run check:config:production` (and `-- --no-dotenv` in CI) → `RESULT: OK`.
- [ ] Hosting platform chosen and project created (Phase 12 §3: `npm ci` · `npm run build` · `npm start`, Node ≥ 20.9);
      pre-build gate `node scripts/config/check-config.mjs --production --no-dotenv --workflows` must not FAIL.
- [ ] Deploy; public smoke test on the provider URL (Phase 12 §6: `/`, `/properties`, draft 404, inquiry 409 for
      non-published, security headers, no `X-Powered-By`).
- [ ] Sign in at `/admin` (cookie `Secure; HttpOnly; SameSite=Lax`); `/admin/operations` shows OK for public DB, admin DB,
      hashed password, production build.
- [ ] Domain attached with HTTPS; `NEXT_PUBLIC_SITE_URL=https://<domain>`; **redeploy** (build-time value); `og:image`
      starts with the domain.
- [x] Local production verification from a clean checkout against the dedicated project (Phase 12 §4–§8).

## 3. Database

- [x] All migrations in `supabase/migrations/` applied to `vqdxqqsvlkddgkzulaxv` (Phase 11; schema verified identical
      to the old project, 6 legacy drafts copied byte-for-byte). If the Supabase CLI is used later, run
      `supabase migration repair` first (Phase 11 §2).
- [ ] Backup/PITR point confirmed before the release.
- [ ] Security advisors show no new findings.
- [ ] In **`/admin/agency`**: the agency's real WhatsApp Business number id (Meta's `phone_number_id`), agency active.
- [ ] In **`/admin/agents`**: create each real agent (name, agency, active). Register their WhatsApp identity from
      their first message under "Unregistered senders" — never type or invent a BSUID.
- [ ] `/admin/operations` → Routing readiness both OK, site profile complete.

## 4. n8n credentials (workflows stay INACTIVE)

- [ ] Re-import the committed exports (`automation/n8n/*.json`, already pointing at `vqdxqqsvlkddgkzulaxv`) — the
      live workflows still point at the old project and the checker refuses them until replaced.
- [ ] `VIP Realty Supabase (service role)` (`supabaseApi`, the dedicated project).
- [ ] `VIP Realty WhatsApp (Meta app)` (`whatsAppTriggerApi`).
- [ ] `VIP Realty WhatsApp Cloud API (access token)` (`whatsAppApi`).
- [ ] Anthropic credential used by `VIP Realty — Property Extraction (AI)`.
- [ ] `N8N_API_URL=… N8N_API_KEY=… npm run check:config -- --production --workflows --n8n` → no errors, no "does not
      exist" warnings, all workflows `inactive`.

## 5. Staged verification (one registered test agent, `zz-` labelled content, no unrelated recipients)

- [ ] Run Submission Extraction and Media Processing **manually once** with an empty queue → clean executions.
- [ ] Activate **WhatsApp Inbound only**; subscribe the webhook in Meta.
- [ ] Test agent sends a text → one message, one session, no property. Unregistered number → `unresolved_sender`.
- [ ] Test agent sends a photo + `done` → run Submission Extraction manually → draft (pending review); run Media
      Processing manually → photo validated and attached; a real object exists in `whatsapp-media` and `property-images`.
- [ ] Admin: review → approve → publish → visible on the site → `sold <link>` from WhatsApp → gone from the site.
- [ ] `/admin/operations`: nothing unexpected under "Needs attention"; no error events.
- [ ] Remove the test listing, media and fixtures.

## 6. Admin workflow verification (before handover)

- [ ] Sign in; each section loads: Review, Properties, Agents, Agency, Pipeline, Operations.
- [ ] Open a draft → **Edit details** → correct a field → saved; an approved draft returns to pending review.
- [ ] Approve → Publish → the listing appears on the website; edit its title → the change is live without a redeploy.
- [ ] Reorder photos and set a cover → the website gallery follows.
- [ ] Mark sold → it leaves the website; restore/relist works.
- [ ] Deactivate a test agent → their messages are stored but create nothing; reactivate.

## 7. Activation (explicit)

- [ ] Activate Submission Extraction, then Media Processing (Inbound already active).
- [ ] `check:config -- --production --workflows --n8n --allow-active` → OK.
- [ ] Watch `/admin/operations` for the first hours (sessions ready > 15 min, failed media, error events).

## Emergency stop

Deactivate WhatsApp Inbound → Submission Extraction → Media Processing. Stored data is kept; leases recover on
reactivation. A wrong status change is reversed in the admin. Rollback details: Phase 9 §14; environment rollback to the
old project (explicit `SUPABASE_PROJECT_REF` pin): Phase 11 §18.

## Known accepted risks at launch

- Draft photos are reachable by anyone who knows their exact URL (random UUID paths, not listable) — Phase 9 §11.
- Single shared admin password (every action is audited as a session reference, not a person); in-memory rate limiting
  per instance — consider an edge rate limiter.
- No WhatsApp replies are sent to agents (Phase 9 §8).
- Listings are created only from WhatsApp submissions; the admin corrects them but cannot create one (Phase 10 §12).
