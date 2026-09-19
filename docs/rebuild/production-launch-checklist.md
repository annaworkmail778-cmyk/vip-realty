# Production launch checklist

Work top to bottom. Every step is an explicit operator action; nothing here happens automatically. Details and the
reasoning behind each gate: [phase-09-production-hardening-e2e.md](phase-09-production-hardening-e2e.md).

## 1. Content (blocks public launch)

- [ ] Real phone, WhatsApp and email in `site.contact` (`lib/site.ts`) — currently placeholders `+37400000000`.
- [ ] Real imagery and statistics; set `MEDIA_IS_PLACEHOLDER = false` in `lib/media.ts` (see `README.md`).

## 2. Website configuration (hosting environment, never in Git)

- [ ] `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` (publishable/anon key).
- [ ] `SUPABASE_SERVICE_ROLE_KEY` — server-only, same project.
- [ ] `ADMIN_PASSWORD_HASH` from `npm run admin:hash-password` (password ≥ 16 chars, stored in a password manager).
- [ ] `ADMIN_SESSION_SECRET` — random, ≥ 32 chars (`openssl rand -base64 48`).
- [ ] No `ADMIN_PASSWORD`, no legacy `TELEGRAM_*` / `CRON_SECRET` / `NEXT_PUBLIC_SITE_URL`, nothing secret under `NEXT_PUBLIC_`.
- [ ] `npm run check:config -- --production --no-dotenv` with the production environment → `RESULT: OK`.
- [ ] Deploy; sign in at `/admin`; `/admin/operations` shows OK for public DB, admin DB, hashed password, production build.

## 3. Database

- [ ] All migrations in `supabase/migrations/` applied (latest `20260919170806_operations_status`).
- [ ] Backup/PITR point confirmed before the release.
- [ ] Security advisors show no new findings.
- [ ] Agency row with the real `whatsapp_phone_number_id`; agents registered (BSUID and/or phone), `is_active`.
- [ ] `/admin/operations` → Routing readiness both OK.

## 4. n8n credentials (workflows stay INACTIVE)

- [ ] `VIP Realty Supabase (service role)` (`supabaseApi`, same project).
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

## 6. Activation (explicit)

- [ ] Activate Submission Extraction, then Media Processing (Inbound already active).
- [ ] `check:config -- --production --workflows --n8n --allow-active` → OK.
- [ ] Watch `/admin/operations` for the first hours (sessions ready > 15 min, failed media, error events).

## Emergency stop

Deactivate WhatsApp Inbound → Submission Extraction → Media Processing. Stored data is kept; leases recover on
reactivation. A wrong status change is reversed in the admin. Rollback details: Phase 9 §14.

## Known accepted risks at launch

- Draft photos are reachable by anyone who knows their exact URL (random UUID paths, not listable) — Phase 9 §11.
- Single shared admin password; in-memory rate limiting per instance — consider an edge rate limiter.
- No WhatsApp replies are sent to agents (Phase 9 §8).
