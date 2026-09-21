# Phase 14 — Connect Production Infrastructure

Status: **BLOCKED — no production resource exists yet.** Checked on 2026-09-21; nothing was invented, simulated or
activated, and no work was built around the missing resources.

| Resource | Check | State |
| --- | --- | --- |
| Hosting | no git remote, no provider config/link, no provider CLI, no provider token in the environment | BLOCKED |
| Domain | none supplied | PENDING |
| Supabase production connection | dedicated project `vqdxqqsvlkddgkzulaxv` exists and is ready (Phase 11); its service-role key is not available to this environment; `.env.local` still targets the old project (unchanged, local development) | BLOCKED (service key) |
| Admin secrets | no `ADMIN_PASSWORD_HASH` / production `ADMIN_SESSION_SECRET` supplied | BLOCKED |
| Site profile | 0 agencies — no real brand/contact values supplied; production gate fails on it and on placeholder imagery/statistics (Phase 13) | BLOCKED |
| n8n | 0 credentials in n8n; 4 VIP Realty workflows, all inactive, not modified | BLOCKED |
| Meta / WhatsApp | no app, number, `phone_number_id`, token or webhook | BLOCKED |
| Real E2E, AI, media/Storage, admin publish, status command | depend on all of the above | BLOCKED (not run) |

Database state (dedicated project): 0 agencies, 0 agents, 0 messages, 0 public listings, 0 Storage objects; legacy rows
unchanged (md5 `d00e55d09f363660b9ce0806a8b95268`). No test data was created, so no cleanup was needed.

## What unblocks this phase (in order)

1. Hosting access + the three secrets (service-role key of `vqdxqqsvlkddgkzulaxv`, admin hash, session secret) — Phase 12 §3.
2. Domain → `NEXT_PUBLIC_SITE_URL` → deploy → `npm run smoke -- https://<domain> --draft-slug modern-residence`.
3. Real brand/contacts (`/admin/agency`), real imagery/statistics → `check:config -- --production --site` OK.
4. n8n credentials against the dedicated project; re-import `automation/n8n/*.json`; `check:config -- --production --workflows --n8n` OK (workflows stay inactive).
5. Meta: direct WhatsApp Business number, `phone_number_id`, system-user token, webhook verify token (never the old group).
6. Then the single isolated E2E and the status-command test (launch checklist §5), cleanup, and an explicit activation decision.
