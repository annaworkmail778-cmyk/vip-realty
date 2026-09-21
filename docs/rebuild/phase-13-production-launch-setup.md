# Phase 13 — Production Launch Setup

Status: **PASS WITH LIMITATION.** The repository is ready for the final production connection; hosting, domain,
secrets and real brand content are not available, so deployment stays **BLOCKED** and every result below is **LOCAL**
(clean checkout, `npm ci`, production build, `next start`, dedicated Supabase project `vqdxqqsvlkddgkzulaxv`).

## 1. Hosting — BLOCKED

No git remote, no provider configuration file or project link, no hosting CLI, no provider token in the environment.
The `.vercel/` line in `.gitignore` is not treated as a platform choice. Deployment settings for any Node host are in
Phase 12 §3 (`npm ci` · `npm run build` · `npm start`, Node ≥ 20.9).

## 2. Production environment — gate fails clearly

`node scripts/config/check-config.mjs --production --no-dotenv --workflows --site` with the target values available today
(URL, project ref, publishable key) reports `RESULT: FAIL` with exactly these items:

| Missing / not ready | Source |
| --- | --- |
| `SUPABASE_SERVICE_ROLE_KEY` | operator (Supabase Dashboard → API keys, dedicated project) |
| `ADMIN_PASSWORD_HASH` | operator (`npm run admin:hash-password`) |
| `ADMIN_SESSION_SECRET` | operator (`openssl rand -base64 48`) |
| `NEXT_PUBLIC_SITE_URL` | domain (§3) |
| Site agency (brand + contacts) | real values at `/admin/agency` |
| Placeholder imagery (`MEDIA_IS_PLACEHOLDER = true`) | real media, then set to `false` in `lib/media.ts` |
| 3 placeholder statistics | audited figures in `lib/site.ts`, or remove the entries |

Values are never printed; variable names only.

## 3. Domain — PENDING

Once a domain exists: attach it on the host (HTTPS issued there), set `NEXT_PUBLIC_SITE_URL=https://<domain>`,
**rebuild/redeploy** (the value is compiled into the build), then `npm run smoke -- https://<domain>` (includes the
http→https redirect check) and confirm `og:image`/`twitter:image` start with the domain.

## 4. Public brand and contact content

| Item | State |
| --- | --- |
| Brand name, legal name, page titles, logo text | database site agency; none configured → working name "VIP Realty" (no guessed brand) |
| Phone, WhatsApp, email, office address, hours | database site agency; none configured → no links rendered, footer says "Contact details are being set up." |
| Footer social links | **fixed**: were dead `href="#"` links; now `href: null` = not rendered. Real URLs go in `lib/site.ts` (external links open with `noopener noreferrer`). Gate: warning while unset |
| Footer disclosure | now "Placeholder imagery and statistics" (contact details are no longer placeholders — they come from the database) |
| Statistics (1,500+ / 10+ / 500+) | placeholder, visibly marked with an asterisk note; **production gate error** until replaced or removed |
| Collection/team imagery, map geometry | placeholder, visibly marked; **production gate error** via `MEDIA_IS_PLACEHOLDER` |
| Metadata | titles follow the site agency; `og:image` uses `NEXT_PUBLIC_SITE_URL` once set |

New gate: `validateContent` (`scripts/config/validate-config.mjs`), run by `check-config --site`: placeholder imagery,
placeholder statistics and dead `#` links are errors in production and warnings in development; unset social links are
a warning. Tests: 2 new (17 config tests total).

## 5. Deployment — BLOCKED

Nothing deployed. Local production build from a clean checkout: exit 0.

## 6. Smoke-test suite

`npm run smoke -- <base-url> [--draft-slug <slug>]` (`scripts/smoke/smoke.mjs`) — read-only (never signs in, never
creates a listing or inquiry). Run against the deployed URL after every deployment.

LOCAL result (`http://localhost:3131`, `--draft-slug modern-residence`): **9/9 PASS** — home 200, properties 200,
unknown listing 404, draft listing 404, empty inquiry 400, `/admin` → `/admin/login`, wrong-password sign-in 503
(not configured: fail closed), image proxy without session 401, security headers present and no `X-Powered-By`.
Plus: client bundle scan 0 matches (keys, tokens, hashes, secret names, phone numbers, BSUID-shaped ids, project refs,
private bucket name); config gate as in §2.

## 7. Database safety

No migration. RSVP, the old shared project, legacy properties, booking removal, n8n workflows and Meta untouched; all 4
workflows inactive.

## 8. Launch order (exact blockers)

1. Choose the host and give access → set the three secrets + URL/ref/publishable key (Phase 12 §3).
2. Domain → `NEXT_PUBLIC_SITE_URL` → deploy → `npm run smoke -- https://<domain> --draft-slug modern-residence`.
3. Real brand/contacts at `/admin/agency`; real imagery and statistics; social URLs.
4. `check:config -- --production --workflows --site` → `RESULT: OK`.
5. Then the integration work of Phase 11 (Meta, n8n credentials, staged E2E, explicit activation).
