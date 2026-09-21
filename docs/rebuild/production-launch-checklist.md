# Production launch checklist (operator)

Work top to bottom; tick each box only with the evidence named in it. Nothing here happens automatically, and no
workflow is activated until step 14. Background for each step: the phase documents indexed in [README.md](README.md);
current status: [final-launch-readiness.md](final-launch-readiness.md).

**Fixed facts.** Production uses the dedicated realty Supabase project **`vqdxqqsvlkddgkzulaxv`**. The old project
`muqfjbkeyvvfvlodzujs` is shared with the wedding RSVP app — never point production at it (the config gate refuses it)
and do not delete it: it is the rollback source until production has run stably. Secrets go only into the hosting
platform / n8n credential store — never into Git, chat or tickets. The production channel is the **direct** WhatsApp
Business number, never the old WhatsApp group.

## 1. Create and configure hosting

- [ ] Choose a Node.js host (Next.js server, not a static export); create the project from this repository.
- [ ] Build settings: install `npm ci`, build `npm run build`, start `npm start`, Node ≥ 20.9 (22 LTS recommended).
- [ ] Optional pre-build gate: `node scripts/config/check-config.mjs --production --no-dotenv --workflows` (build must
      not continue on `RESULT: FAIL`).

## 2. Configure the production environment (platform settings, marked sensitive where noted)

- [ ] `NEXT_PUBLIC_SUPABASE_URL=https://vqdxqqsvlkddgkzulaxv.supabase.co`
- [ ] `SUPABASE_PROJECT_REF=vqdxqqsvlkddgkzulaxv`
- [ ] `SUPABASE_PUBLISHABLE_KEY` — Supabase Dashboard → project `vqdxqqsvlkddgkzulaxv` → API keys → publishable.
- [ ] `SUPABASE_SERVICE_ROLE_KEY` (**sensitive**) — same page, secret/service-role key of **that** project.
- [ ] `ADMIN_PASSWORD_HASH` (**sensitive**) — run `npm run admin:hash-password` locally, type a ≥ 16-character password
      (keep it in a password manager), paste the printed hash.
- [ ] `ADMIN_SESSION_SECRET` (**sensitive**) — `openssl rand -base64 48`.
- [ ] Not set: `ADMIN_PASSWORD`, `CRON_SECRET`, `TELEGRAM_*`, anything secret under `NEXT_PUBLIC_*`, the old project.
- [ ] Deploy. Then `npm run smoke -- https://<provider-url> --draft-slug modern-residence` → all PASS.
- [ ] Sign in at `https://<provider-url>/admin` → `/admin/operations` shows OK for public database, admin database,
      password hash, production build.

## 3. Configure the domain

- [ ] Attach the domain on the host; HTTPS certificate issued.
- [ ] Set `NEXT_PUBLIC_SITE_URL=https://<domain>` and **redeploy** (the value is compiled into the build).
- [ ] `npm run smoke -- https://<domain> --draft-slug modern-residence` → all PASS (includes http → https).
- [ ] Page source of `/`: `og:image` and `twitter:image` start with `https://<domain>`.

## 4. Configure the real agency, brand and contacts

- [ ] Confirm the production brand with the client (the working name `VIP Realty` is not a chosen brand).
- [ ] `/admin/agency` → new agency: display name (brand), legal name, public phone, public WhatsApp, public email,
      office address, hours; tick "website agency"; active. Placeholder-looking values are refused.
- [ ] Real imagery and audited statistics; set `MEDIA_IS_PLACEHOLDER = false` (`lib/media.ts`); replace or remove the
      statistics (`lib/site.ts`); add real social URLs or leave them unset (hidden). Commit, redeploy.
- [ ] `npm run check:config -- --production --site` (with the production variables) → no content or profile errors.

## 5. Configure agents

- [ ] `/admin/agents` → create each real agent (name, agency, active). Do **not** type WhatsApp ids.
- [ ] After step 9, link each agent's identity from their first real message under "Unregistered senders".

## 6. Configure n8n credentials (n8n → Credentials; workflows stay inactive)

- [ ] `VIP Realty Supabase (service role)` — type Supabase API, host `https://vqdxqqsvlkddgkzulaxv.supabase.co`,
      service-role key.
- [ ] `VIP Realty WhatsApp (Meta app)` — WhatsApp trigger (app id/secret).
- [ ] `VIP Realty WhatsApp Cloud API (access token)` — WhatsApp API (system-user token).
- [ ] AI: the Property Extraction workflow uses the n8n-managed Anthropic credit (or an Anthropic credential).

## 7. Import the current workflows

- [ ] Import the four files in `automation/n8n/*.json` (they point at `vqdxqqsvlkddgkzulaxv`), replacing the old
      versions; attach the credentials of step 6 by name; leave all **inactive**.
- [ ] `N8N_API_URL=… N8N_API_KEY=… npm run check:config -- --production --workflows --n8n` → no errors, no missing
      credential warnings, all `inactive`.

## 8. Configure Meta / WhatsApp

- [ ] Meta app with WhatsApp; the **direct** business number registered; note its `phone_number_id`.
- [ ] `/admin/agency` → set the agency's WhatsApp Business number id (`phone_number_id`).
- [ ] System-user access token with WhatsApp permissions (in the n8n credential of step 6 only).

## 9. Verify the webhook

- [ ] Activate **WhatsApp Inbound only**; in Meta, set the webhook URL shown by its trigger and the verify token;
      verification succeeds; subscribe to `messages`.
- [ ] A text from an unregistered phone → stored as `unresolved_sender`, nothing else created.
- [ ] Link the test agent (step 5); a text from them → one message, one session, no property.

## 10. Run the isolated E2E (one registered test agent; text labelled `E2E TEST`; never a client property)

- [ ] Test agent sends a listing text + one photo, then `done`.
- [ ] Run **Submission Extraction manually** → one draft, pending review, extraction valid.
- [ ] Run **Media Processing manually** → photo validated; objects exist in `whatsapp-media` and `property-images`;
      one gallery image on the draft.

## 11. Verify admin publish

- [ ] Review the draft: provenance and photo visible → approve → publish.
- [ ] Edit a field → change is live without a redeploy; reorder/cover works.

## 12. Verify the public site

- [ ] The listing appears on `/properties` and its page; photo loads; Call/WhatsApp links use the agency's real numbers.
- [ ] "Request more information" on it → inquiry stored (check in the database) → then delete the test inquiry.

## 13. Verify the status command

- [ ] From the test agent: `sold <exact-slug>` (or `rented …` for a rental) → listing leaves the website; only that
      property changed. Send the same command again → no second change.
- [ ] Clean up: delete the test listing, its images and Storage objects, messages, sessions, extraction, events,
      inquiry; unlink/deactivate the test agent. `/properties` shows no test listing.

## 14. Activate the workflows explicitly

- [ ] Only if steps 1–13 are all ticked: activate **Submission Extraction**, then **Media Processing**
      (Inbound is already active).
- [ ] `check:config -- --production --workflows --n8n --allow-active` → OK.

## 15. Monitor the first production message

- [ ] First real agent message: one message, one session, draft after `done`, photos attached.
- [ ] `/admin/operations` for the first hours: nothing under "Needs attention", no sessions waiting > 15 min, no failed
      media, no error events.

## 16. Rollback

- **Emergency stop:** deactivate WhatsApp Inbound → Submission Extraction → Media Processing. Stored data is kept;
  processing resumes safely on reactivation.
- **Wrong status change:** restore/relist the listing in the admin.
- **Application:** promote the previous deployment on the host (or redeploy the previous commit).
- **Environment:** restore the previous variables; to run on the old project deliberately, also set
  `SUPABASE_PROJECT_REF=muqfjbkeyvvfvlodzujs` (the gate then accepts it with a warning). Never delete either project.
- **n8n:** deactivate, restore the previous workflow version (n8n history) or re-import the previous export.
- **Meta:** unsubscribe the webhook / deactivate WhatsApp Inbound.

## Known accepted risks at launch

- Draft gallery photos sit in the public bucket at unguessable, unlisted paths (Phase 9 §11); the bucket split should
  be done before real listing volume.
- One shared admin password (actions audited per session, not per person); rate limiting is per instance.
- No WhatsApp replies are sent to agents (outbound not implemented; needs a token and approved templates).
- Listings are created only from WhatsApp submissions; the admin edits but does not create them.
