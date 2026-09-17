# Phase 0 — Baseline checkpoint

Status: **complete** (local). No secrets or environment values appear in this document.

## Repository

| Item | Value |
| --- | --- |
| Repository path | `/Users/annaghazaryan/vip realty` |
| Baseline commit | `defbaf26f49480fc0ca7bf0365c4c8746dc3be75` |
| Commit message | `chore: baseline snapshot before VIP Realty rebuild` |
| Baseline tag | `baseline-pre-rebuild` → `defbaf26f49480fc0ca7bf0365c4c8746dc3be75` |
| `main` | `defbaf26f49480fc0ca7bf0365c4c8746dc3be75` (same as the tag) |
| Implementation branch | `phase/01-supabase-foundation`, created from `baseline-pre-rebuild` |
| Git author (repository scope only) | `annaworkmail778-cmyk` |
| Git remote | none configured; nothing pushed |
| Files in baseline | 154 (about 19 MB, largest file about 3.3 MB) |
| Git status after baseline | working tree clean |

## What the baseline contains

The baseline is the **current working application, unchanged**:

- the booking / viewing system (public booking panel, `/viewings/[reference]`, booking APIs, reminder cron route, `lib/booking`, `lib/notifications`, booking admin screens, booking Supabase migrations and the `viewing-reminders` edge function) — **booking is still present**;
- the static property model (`lib/properties.ts`, local images in `public/media`);
- the password-gated admin;
- all existing scripts, docs and configuration.

## Checks

| Check | Result |
| --- | --- |
| `npm run lint` | passed, 0 errors |
| `npm run build` | passed, Next.js 16.3.4, all 37 routes (booking routes included); the build changed no committed file |
| `git diff --cached --check` | clean |

## Secret audit

Result: **passed**. No credential values are committed.

- `.env.local` (real local configuration) is ignored and not committed.
- `.data/` (development booking store with test personal data) is ignored and not committed.
- `.claude/settings.local.json` is ignored.
- `.env.example`, `README.md` and `docs/booking-system.md` contain variable names with empty values or placeholders only.
- Application code reads secrets from the environment; nothing is hard-coded.
- Pattern matches in `package-lock.json` are package integrity hashes (false positives).
- No private keys, `.pem` files, `sb_secret_` keys, JWT values or third-party API keys were found outside `node_modules`.

## `.gitignore` hardening

Existing rules were kept. Added:

```
.env
*.pem
.vercel/
supabase/.temp/
.claude/settings.local.json
```

`.env.local` and `.data/` were already ignored (`.env*.local`, `.data`). `.env.example` remains committed.

## Files changed in Phase 0

- `.gitignore` (hardening above; included in the baseline commit)
- `docs/rebuild/phase-00-baseline.md` (this file; committed on `phase/01-supabase-foundation`, **not** part of the baseline tag)

## Scope statement

- Application code, routes, styling and dependencies were **not** modified.
- Booking was **not** removed.
- Supabase was **not** modified (no schema, data, migration or function changes).
- n8n was **not** modified (no workflows or credentials).
- WhatsApp was **not** configured.
- Deployment was **not** configured.

## Known pre-existing risks (from the audit and preflight)

1. **No off-machine copy yet.** The repository has no remote; until a private GitHub repository is added and pushed, the baseline exists only on this computer.
2. **Shared Supabase project.** The project referenced in `.env.local` also hosts an unrelated wedding RSVP app.
3. **Supabase schema drift.** Booking functions in that project reference a `notification_events` table that does not exist; local and remote migration histories differ.
4. **Site does not use Supabase today.** The service-role key is empty locally, so bookings run on the file-based development store.
5. **Weak local admin password.** Must be replaced before any deployment.
6. **Placeholder content.** Brand name in code ("Lumina Estates") differs from the project name; phone, WhatsApp, email and domain are placeholders.
7. **In-memory rate limiting** in the booking/admin APIs does not work across serverless instances.
8. **The baseline tag is lightweight.** It points directly at the commit; treat it as immutable and never move or delete it.

## Rollback

Restore the exact pre-rebuild application:

```bash
git -C "/Users/annaghazaryan/vip realty" switch --detach baseline-pre-rebuild
```

Start a fresh branch from the baseline:

```bash
git -C "/Users/annaghazaryan/vip realty" switch -c restore/baseline baseline-pre-rebuild
```

After restoring, run `npm ci` and `npm run build`. The local `.env.local` is not in Git and must be kept separately.

## Next phase

**Phase 1 — Supabase Foundation**, on branch `phase/01-supabase-foundation`. Not started.
