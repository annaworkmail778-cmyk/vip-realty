# Phase 12 — Production Deployment

Status: **PASS WITH LIMITATION — deployment BLOCKED, local production verification LIVE.**
No hosting provider, hosting account, deployment token or git remote exists in this environment, and no domain was
supplied. Nothing was deployed and no deployment success is claimed. The application was built and run **in production
mode from a clean checkout** against the dedicated realty Supabase project (`vqdxqqsvlkddgkzulaxv`), and every smoke
test that does not need a production secret was run against that build.

Labels: **LIVE** = executed for real in this phase · **BLOCKED** = needs something that does not exist yet ·
**PENDING** = an operator decision/value not supplied yet.

## 1. Audit

| Item | Finding |
| --- | --- |
| Hosting platform | **None configured.** No `vercel.json`/`netlify.toml`/Dockerfile/`.vercel` link, no hosting CLI installed, no git remote. `.gitignore` reserves `.vercel/` (Phase 0), so Vercel is the likely intent — it is **not** assumed. |
| Build | `next build` (Next 16, Turbopack). Standard Node server (`next start`); no static export, no edge-only code. Node ≥ 20.9 (now declared in `package.json` `engines`). |
| Scripts | `build`, `start`, `lint`, `test` (media + config), `check:config`, `check:config:production`, `admin:hash-password`. |
| Environment variables read at runtime | `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_PASSWORD_HASH`, `ADMIN_SESSION_SECRET`, `ADMIN_PASSWORD` (dev only, ignored in production), `NEXT_PUBLIC_SITE_URL` (metadata). All secrets are read only in `lib/env.ts`, which is `server-only` (a client import is a build error). |
| `SUPABASE_PROJECT_REF` | Enforced by the config gate (Phase 11), not read at runtime — the gate is the deploy-time check (§3). |
| `NEXT_PUBLIC_SITE_URL` | Sets `metadataBase`; unset → metadata URLs use the request host. Baked in at build time. **PENDING** (no domain). |
| Admin auth in production | Fails closed: sign-in needs `ADMIN_PASSWORD_HASH` (scrypt) + `ADMIN_SESSION_SECRET` (≥ 32 chars); plaintext password ignored. Cookie `HttpOnly`, `SameSite=Lax`, `Secure` in production, 12 h. |
| Image proxy | `/api/admin/images/{property|media}/{id}`: admin session required, object resolved by id in the database (never a caller path), downloaded with the service role, no-store, nosniff, sandboxing CSP. |
| Public routes | `/`, `/properties`, `/properties/[slug]`, `/api/inquiries`; everything under `/admin` and `/api/admin` is session-gated. |
| Data freshness | Public reads call `connection()` and fetch with `cache: "no-store"`; no `generateStaticParams`; build output marks every data route `ƒ` (server-rendered on demand). Admin actions also `revalidatePath` the listing. **A newly published listing appears without a rebuild.** No caching was added. |
| Domain | None supplied. |

## 2. Changes in this phase (deployment configuration only)

* `next.config.ts`: `poweredByHeader: false` and baseline headers on every route — `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (camera, microphone,
  geolocation, payment off), `Strict-Transport-Security: max-age=31536000` (no `includeSubDomains`/`preload`; ignored on
  http). **No CSP** — the site's media/fonts/animation need a reviewed policy; routes keep their own stricter headers
  (image proxy CSP, `no-store`).
* `package.json`: `"engines": { "node": ">=20.9.0" }` (Next 16's requirement; hosting platforms pick the runtime from it).

No database, product, WhatsApp or n8n change.

## 3. Hosting configuration (to apply on the chosen platform — BLOCKED here)

| Setting | Value |
| --- | --- |
| Framework | Next.js (auto-detected), Node 20.9+ (22 LTS recommended) |
| Install / build / start | `npm ci` · `npm run build` · `npm start` (a Node server; not a static export) |
| Pre-build gate (recommended) | `node scripts/config/check-config.mjs --production --no-dotenv --workflows` — add `--site` once the site agency exists; the build must not proceed on `RESULT: FAIL` |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://vqdxqqsvlkddgkzulaxv.supabase.co` |
| `SUPABASE_PROJECT_REF` | `vqdxqqsvlkddgkzulaxv` |
| `SUPABASE_PUBLISHABLE_KEY` | the dedicated project's publishable key (not secret, but server-only in this app) |
| `SUPABASE_SERVICE_ROLE_KEY` | **secret** — operator supplies (Supabase Dashboard → API keys); mark "sensitive" on the platform |
| `ADMIN_PASSWORD_HASH` | **secret** — `npm run admin:hash-password` (password ≥ 16 chars, kept in a password manager) |
| `ADMIN_SESSION_SECRET` | **secret** — `openssl rand -base64 48` |
| `NEXT_PUBLIC_SITE_URL` | **PENDING** — the real https domain (baked into the build: redeploy after setting it) |
| Must NOT be set | `ADMIN_PASSWORD`, `CRON_SECRET`, `TELEGRAM_*`, any `NEXT_PUBLIC_*` secret, the old project's URL/keys |

No other variable is read by the code. `.env.production` is not used or committed; secrets live only in the platform's
environment settings.

## 4. Deployment — BLOCKED

Needs: a hosting account/project (or platform token) and, ideally, a git remote. Once available: create the project,
enter §3 variables, deploy, then run §6–§7 against the provider URL, then the domain (§5).

**What was run instead (LIVE, local production):** `git archive` of the commit → clean directory → `npm ci` →
`next build` with only the target variables (`NODE_ENV=production`, dedicated project URL, project ref, publishable key;
no `.env*` file present) → `next start`. Build exit 0; server started; all routes as in §1.

## 5. Domain — PENDING

No domain supplied; none invented. `NEXT_PUBLIC_SITE_URL` stays unset, and the production gate reports it missing. Until
it is set, Open Graph/Twitter image URLs resolve against the request host (verified: `og:image` =
`http://localhost:3121/media/hero/og.jpg` in the local run), which on a provider URL is still correct and absolute. After
the domain is attached on the platform (HTTPS is issued by the platform): set `NEXT_PUBLIC_SITE_URL=https://<domain>`,
redeploy, and check that `og:image` starts with the domain.

## 6. Public smoke test — LIVE against the local production build (deployed site: BLOCKED)

| Check | Result |
| --- | --- |
| `/` | 200 |
| `/properties` — zero-listing state | 200; `listings: []`, "Nothing matches those filters.", category counts 0 |
| Published listing route | not applicable — 0 published listings exist (none was created) |
| Draft (`/properties/modern-residence`, a legacy draft) | 404, no listing content in the response |
| Unknown slug | 404 |
| Request More Information — malformed body | 400 `invalid_input` |
| — well-formed, draft slug | 409 `property_unavailable` (same answer as an unknown slug; no row written) |
| — cross-site origin | admin login 403; the inquiry probe hit the rate limiter first (429), so the inquiry origin check was not isolated in this run |
| Call / WhatsApp links | none rendered — no site agency configured; footer shows "Contact details are being set up." (no placeholder numbers) |
| `/admin`, `/admin/operations`, `/admin/properties` (anonymous) | 307 → `/admin/login` |
| Admin image proxy (anonymous) | 401, `no-store` |
| Security headers | present on pages, 404s, redirects, API and static media; `X-Powered-By` absent |
| Response caching | pages `private, no-cache, no-store` |

Database afterwards (dedicated project): 0 inquiries, 0 events, 0 agencies/agents, 0 Storage objects, 0 public
listings, legacy rows unchanged (md5 `d00e55d09f363660b9ce0806a8b95268`).

## 7. Admin smoke test

**Production credentials: BLOCKED** (none exist; no production login was attempted or claimed).

**Fail-closed (LIVE, local production build, no admin secrets):** `POST /api/admin/login` → 503 "Admin sign-in is not
configured on this server." (the missing setting is not named to anonymous callers); every admin page redirects to login.

**Session mechanics (LIVE, local production build, throwaway credentials):** a random password and session secret were
generated inside the test script, hashed with `admin:hash-password`, used only for that local process and discarded —
never printed, stored or committed; they are not production credentials. Results: wrong password 401; correct password
200 with `Set-Cookie: …; Max-Age=43200; Secure; HttpOnly; SameSite=lax`; signed-in `/admin`, `/admin/operations`,
`/admin/properties`, `/admin/agency` 200; tampered cookie → 307 to login; logout 200 clears the cookie (`Max-Age=0`,
same flags). Without a service key the admin shows "Not configured" for listing management and the image proxy returns
503 (fails closed). `/admin/operations` showed: public database OK, admin database **NO**, password hash OK, production
build OK — and contained no key, hash, project ref or identity value.

Note: the "Not configured" hint names `.env.local`; on a hosting platform the variable goes into the platform's
environment settings (cosmetic; unchanged in this deployment-only phase).

## 8. Security

| Check | Result |
| --- | --- |
| Client bundle (`.next/static`, 1.3 MB) | 0 matches: JWT/service-role keys, `sb_secret_`, publishable key, Meta `EAA…` tokens, `sk-ant-`, scrypt hashes, secret variable names, BSUID-shaped ids, `+374…` phone numbers, either project ref, `whatsapp-media` |
| Server bundle | only supabase-js's own `sb_publishable_`/`sb_secret_` prefix checks (library code, no values) |
| Service role | server-only (`lib/env.ts` is `server-only`); config gate rejects secrets under `NEXT_PUBLIC_*` |
| Admin cookie | `Secure; HttpOnly; SameSite=Lax` in production (§7) |
| `.env.production` | does not exist; `.env*` ignored except `.env.example` |
| Deployment logs | none exist (no deployment); local build/start logs contain no secret values |
| Draft routes | 404 |
| Anonymous database access | unchanged since Phase 11 (private tables, admin views and RPCs denied) |
| Private WhatsApp media | `whatsapp-media` private and empty; admin image proxy session-gated |

## 9. Test results

| Test | Result |
| --- | --- |
| Typecheck (`tsc --noEmit`) | pass |
| Lint (`eslint .`) | pass |
| Production build (repo) | exit 0 |
| Production build (clean checkout, `npm ci`, target env only) | exit 0 |
| `npm test` | 26/26 (media 11, config 15) |
| Production config gate, target env | FAIL, exactly on the missing operator inputs: service key, session secret, password hash, site URL, site agency; exports and live-shape checks otherwise clean |
| Public smoke (§6) | every row in §6 as expected (published-listing route not applicable: 0 published) |
| Admin fail-closed + session (§7) | every check in §7 as expected |
| Secret scan (repo, diff, bundle) | clean |

## 10. LIVE / BLOCKED / PENDING

| Item | State |
| --- | --- |
| Local production build and start (clean checkout) | LIVE |
| Public smoke test on local production build | LIVE |
| Admin fail-closed and cookie flags on local production build | LIVE |
| Bundle secret scan | LIVE |
| Hosting project and environment variables | BLOCKED (no platform/account) |
| Production deployment | BLOCKED |
| Public/admin smoke test on the deployed site | BLOCKED |
| Production admin sign-in | BLOCKED (no production credentials) |
| Domain, HTTPS, `NEXT_PUBLIC_SITE_URL` | PENDING (no domain) |
| Brand/contacts, social links (`href="#"` placeholders), placeholder imagery | PENDING (launch checklist §1) |
| n8n / Meta | not touched; all 4 workflows inactive |

## 11. Rollback

Nothing is deployed. The two configuration changes are reverted with `git revert` of this commit. After a future
deployment: promote the previous deployment or roll back the environment per Phase 11 §18.

## 12. Remaining blockers

1. Choose the hosting platform and provide access (account/token, optionally a git remote).
2. Operator enters the §3 secrets on the platform (service key, admin hash, session secret).
3. Real domain → `NEXT_PUBLIC_SITE_URL` → redeploy.
4. Then: deployed smoke tests (§6, §7 with the real admin), followed by the Phase 11 blockers (brand/agency, Meta, n8n
   credentials, staged E2E, explicit activation).
