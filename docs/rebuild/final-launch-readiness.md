# Final launch readiness

Assessed 2026-09-21 on `phase/15-final-qa-handover`. Outcome **B — infrastructure still missing**: final local
verification only; nothing was deployed, connected, simulated or activated. Operator steps:
[production-launch-checklist.md](production-launch-checklist.md).

| Area | READY / BLOCKED / PENDING | Evidence | Action required |
| --- | --- | --- | --- |
| Application | READY | typecheck, lint, production build pass; `npm test` 28/28; clean-checkout production build + 9/9 local smoke (Phase 13); 0 secrets in repo and client bundle | none (content items under Agency) |
| Supabase | READY | dedicated project `vqdxqqsvlkddgkzulaxv`: full schema, verified identical to the old project (Phase 11); no RSVP/booking objects; 6 legacy drafts byte-identical (md5 `d00e55d0…`), 0 public; anonymous access restricted | provide its service-role key to the host and n8n; confirm backup/PITR |
| Admin | BLOCKED | fail-closed verified locally (sign-in 503 without secrets; Secure/HttpOnly/SameSite cookie with test credentials) | set `ADMIN_PASSWORD_HASH`, `ADMIN_SESSION_SECRET`, service-role key on the host |
| Hosting | BLOCKED | no remote, provider config, CLI or token | checklist §1–§2 |
| Domain | PENDING | none supplied; `NEXT_PUBLIC_SITE_URL` unset (gate: MISSING) | checklist §3 (redeploy after setting) |
| Agency (brand, contacts, content) | BLOCKED | 0 agencies; gate: no site agency, placeholder imagery, 3 placeholder statistics; social links unset (hidden) | checklist §4 with real, client-confirmed values |
| Agents | BLOCKED | 0 agents | checklist §5, identities linked from real messages only |
| n8n | BLOCKED | 0 credentials; 4 workflows inactive, live copies still point at the old project; committed exports point at the dedicated project | checklist §6–§7 |
| Meta / WhatsApp | BLOCKED | no app, number, `phone_number_id`, token or webhook | checklist §8–§9 (direct number, never the old group) |
| AI | BLOCKED | never invoked live; deterministic validation tested in the database | runs in checklist §10 |
| Media | BLOCKED | download/validation code unit-tested with synthetic fixtures only | checklist §10 |
| Storage | BLOCKED | 0 objects; no real upload performed | checklist §10; plan the draft/public bucket split (Phase 9 §11) |
| Outbound messaging | BLOCKED | not implemented; reply text is produced and audited in the database | needs token + approved templates; separate decision |
| Monitoring | READY (pending use) | `/admin/operations` (counts, health, recent problems, no secrets) verified locally; config gate; `npm run smoke` | checklist §15 after activation |
| Rollback | READY | old project untouched (RSVP 1 row, legacy md5 unchanged); rollback procedure documented; workflows inactive | checklist §16 |

## Configuration gate (production profile, values never printed)

| Item | State |
| --- | --- |
| Dedicated Supabase project (`NEXT_PUBLIC_SUPABASE_URL`) | READY |
| `SUPABASE_PROJECT_REF` | READY (pins the dedicated project) |
| Supabase publishable key | READY (exists; to be entered on the host) |
| Supabase service-role key | MISSING |
| Admin password hash | MISSING |
| Admin session secret | MISSING |
| `NEXT_PUBLIC_SITE_URL` | MISSING (domain PENDING) |
| Site agency | MISSING |
| Real brand | MISSING |
| Real contacts | MISSING |
| Real imagery/content | INVALID (placeholder imagery, 3 placeholder statistics) |
| Hosting | BLOCKED |
| Domain | PENDING |
| n8n credentials | MISSING |
| Meta/WhatsApp credentials | MISSING |

## Order of operations to go live

1. Host + environment (checklist §1–§2) → deploy → smoke on the provider URL → admin sign-in.
2. Domain → `NEXT_PUBLIC_SITE_URL` → redeploy → smoke on the domain (§3).
3. Real agency, brand, contacts, content → gate clean (§4); agents (§5).
4. n8n credentials + import workflows, all inactive (§6–§7).
5. Meta number + token → webhook with WhatsApp Inbound only (§8–§9).
6. One isolated E2E, admin publish, public check, status command, cleanup (§10–§13).
7. Explicit activation (§14) → monitor the first production message (§15). Rollback ready throughout (§16).
