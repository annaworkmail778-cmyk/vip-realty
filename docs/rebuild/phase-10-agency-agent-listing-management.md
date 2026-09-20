# Phase 10 — Agency, Agent and Listing Management

> Turns the review system into an operations console: the agency's own profile, its agents and their WhatsApp
> identities, human correction of listing content, gallery order, and one configured source for the site's brand and
> contact details. No AI writes anything new here — every mutation is a human action validated by the database.

## 1. What already existed (not rebuilt)

Review/approve/reject, publish, sold/rented/archive/restore, the publication rule set
(`property_publication_check`), `state_version` optimistic concurrency, the authenticated admin image proxy, the
WhatsApp status commands and the Phase 6.5 identity model. Phase 10 calls those functions; it does not duplicate them.

## 2. Agency model

`agencies` gains a public profile and two state flags (migration `20260919174322_agency_agent_management`):

| Column | Purpose |
| --- | --- |
| `display_name` | **The brand.** Drives the logo, page titles, metadata and every mention of the agency on the site |
| `legal_name` | Footer copyright line (falls back to the display name) |
| `public_phone`, `public_whatsapp`, `public_email` | The site's Call / WhatsApp / email actions |
| `office_address`, `office_hours` | Shown in the footer, menu and listing contact panel |
| `is_active` | Inactive ⇒ inbound WhatsApp is stored but never processed, no drafts, nothing new publishable |
| `is_site_primary` | The one agency whose profile the website shows (partial unique index; must be active) |

Constraints: E.164 phones, email shape, length and control-character limits, `not is_site_primary or is_active`.
`contact_is_placeholder()` refuses obviously fake values (example/test domains, `00000000`-style numbers) — the same
rule is mirrored in JavaScript for the launch gate.

Writes go only through **`admin_save_agency(id, values, expected_updated_at, actor)`**: a fixed field whitelist
(unknown key ⇒ `unknown_field`), normalisation, `updated_at` as the concurrency token, and these rules:

- the slug is immutable after creation;
- the website agency cannot be unset from the form — another agency is made primary instead (single statement, so the
  unique index never sees two);
- the website agency cannot be deactivated;
- an agency with published listings cannot be deactivated (`has_published_listings` names the count);
- every change writes `agency.created` / `agency.updated` with the changed **field names**.

**Not built** (deliberately): billing, subscriptions, teams, per-user permissions, CRM. No credential is ever stored
on an agency record — `whatsapp_phone_number_id` is Meta's public routing id, not a secret.

## 3. Agent model and BSUID mapping

`admin_save_agent(id, values, expected_updated_at, actor)` — whitelist: `agency_id`, `name`, `whatsapp_user_id`
(BSUID), `whatsapp_phone`, `phone`, `email`, `is_active`. Phase 6.5 rules are preserved and tightened:

- **BSUID is the preferred identity** and is globally unique (Phase 6.5 index); the function reports `in_use` with the
  other agent's name instead of failing raw.
- **Phone is the fallback**, resolved only inside the routed agency. The admin function additionally refuses a
  WhatsApp phone already registered to *any* other agent, so one human identity never maps to two agents.
- **Identity conflicts stay blocked** in ingestion (a phone-matched agent registered under a different BSUID →
  `identity_conflict`, unresolved, no mutation). Ingestion still never creates or modifies an agent.
- **An agent's agency is fixed once they have history** (listings, sessions or messages) → `agent_has_history`;
  historical ownership therefore stays intact. A misassigned brand-new agent can still be moved.
- New or re-assigned agents may only be placed in an **active** agency.
- Audit events record `set` / `changed` / `removed` for identities — **never the identity values**.

**Registering a real identity without typing it:** `admin_unlinked_senders` (service-role view) lists direct senders
the pipeline could not attribute, plus BSUIDs seen for phone-registered agents. `admin_link_agent_identity(agent,
message, expected_updated_at, actor)` copies the identity **from the stored message** after checking the message is
direct, belongs to the agent's agency, is not already another agent's, and does not contradict the agent's registered
phone. Historical messages are **not** reprocessed — the agent's next message resolves normally.

**Deactivating an agent:** inbound messages are still stored; no session, no draft, no status command (all
`unresolved_sender` / `agent_inactive`); existing listings keep their owner and stay exactly as they are; a new draft
from an already-extracted session is refused with `agent_inactive`.

**Inactive agency** (new in this phase): ingestion stores the message and reports `agency_inactive`; draft generation
refuses with `agency_inactive` (derived from the agency row's `is_active`, with `agency_mismatch` still reported when
the agent simply belongs elsewhere); `property_publication_check` adds an `agency_inactive` blocker.

## 4. Listing editing

`admin_update_property(id, expected_version, changes, actor)` — the only admin write path for listing content.

**Editable** (whitelist): `title`, `description`, `intent`, `property_type`, `price`, `currency`, `price_period`,
`price_negotiable`, `area_sqm`, `land_area_sqm`, `rooms`, `bedrooms`, `bathrooms`, `floor`, `total_floors`,
`year_built`, `country`, `city`, `district`, `address`, `features`.

**Never editable** — any attempt returns `field_not_editable` naming the field: `agency_id`, `agent_id` (ownership),
`created_from_session_id`, `source`, `metadata` (provenance), `slug`, `listing_status`, `published_at`,
`listing_status_changed_at` (lifecycle), `review_status`, `review_note`, `reviewed_at`, `reviewed_by` (review),
`state_version`, `featured`, coordinates, and anything unknown.

**State rules**

| State | Behaviour |
| --- | --- |
| draft, pending | edited, stays pending |
| draft, approved | edited, **returns to pending review** (`reviewed_at` / `reviewed_by` cleared) |
| draft, rejected | edited, returns to pending (the rejection note is cleared; it stays in the event log) |
| published | edited in place **only if the edit introduces no new publication blocker**; otherwise nothing is saved |
| sold / rented / archived | refused (`invalid_state`) — restore to draft first |
| legacy rows (no agency) | refused (`not_editable`) |

**Publication safety after edits.** For a published listing the function compares `property_publication_check`
blockers *before* and *after* the update inside the same transaction; a new blocker rolls the update back and returns
`blocked` with the blocker list. The `properties_publishable` CHECK constraint is the second line of defence (it
refuses, e.g., clearing the city of a live listing) and is reported as a `publication` field error. Pre-existing
blockers an edit cannot fix (for example the agent has since been deactivated) do **not** block unrelated corrections.

**Extraction conflicts.** A conflict on a field an admin has since edited counts as resolved — the human value
replaces both AI candidates. Edited field names are tracked in `metadata.admin.edited_fields`, maintained by the
database, never by the browser.

**Every edit** is transactional, version-checked (`stale`), idempotent (an identical payload returns `unchanged`
without bumping the version), and audited (`property.edited` with the changed field names, before/after values, and
whether review was reset; the description records lengths only).

## 5. Image management

`admin_arrange_property_images(property, expected_version, image_ids, primary_image_id, actor)` reorders a listing's
own gallery and picks the cover. The payload must be **exactly that listing's image set, each id once**; anything
else (a foreign image, a partial set, a duplicate, a foreign cover) is refused as `image_mismatch`. Sort order is
rewritten 0…n-1 under the deferred unique constraint, exactly one row keeps `is_primary`, and the listing's
`state_version` is bumped so concurrent edits are detected. Photos can never be moved between listings: Phase 7's
provenance trigger keeps `(property, agency, media, storage path)` immutable, and no foreign key is editable.

The admin sees every photo with its order, cover flag and origin through the authenticated proxy; held, rejected,
failed and expired WhatsApp media keep their existing places on the listing page and `/admin/pipeline`. Private media
stays private and published image URLs are unchanged.

## 6. Production contact configuration and branding

One source: the site agency's public profile. `lib/site.ts` no longer contains a brand name, legal name or any
contact detail; `lib/site/profile.ts` (shared) plus `profile.server.ts` (reads `public_site_profile` once per request)
provide them, and `SiteProfileProvider` passes the value to client components. The logo renders the configured name
as a wordmark; titles, Open Graph, the footer, the menu, the About section, the closing CTA and the listing contact
panel all follow it.

Until an agency is configured the site shows the **project working name** (`WORKING_BRAND_NAME = "VIP Realty"`,
flagged as a launch item, not a chosen brand) and **no contact details at all** — each action is hidden rather than
filled with a placeholder. `npm run check:config -- --site` reports this, and `npm run check:config:production`
**fails** while the profile is missing, incomplete or placeholder-looking. `NEXT_PUBLIC_SITE_URL` is now a real,
production-required setting (https, no `*.example` domain) used for page metadata.

The retired names (`Lumina Estates`, `APEX`) and hard-coded contact details are gone from the source and a test
(`scripts/config/branding.test.mjs`) fails if any of them, or a `tel:` / `wa.me` / `+374` literal, comes back.

## 7. Initial setup (no fake production data)

There is no seed script and no fixture agency. The operator creates the real agency at `/admin/agency` (which becomes
the website profile) and the real agents at `/admin/agents`, then registers each agent's BSUID from their first
message. With no real data available, the database is left **empty** — the UI exists, nothing is invented. Placeholder
contact values are refused by the database itself.

## 8. Admin structure

`Review` · `Properties` · `Agents` · `Agency` · `Pipeline` · `Operations` (Review and Properties are the same route
with a different filter). Every page sits behind the Phase 9 hardened session (server-side `redirect` before any data
is queried), has loading, error and empty states, disables its submit button while a mutation is in flight, and shows
the database's own validation message against the field that caused it. `/admin/operations` now also reports site
profile readiness (missing and placeholder-looking fields, by name) and inactive agencies/agents.

## 9. Security

- Service role stays server-side; the client bundle was scanned after the build: **0** secrets, 0 identity or contact
  values (only admin form field *names*, which are not data).
- BSUIDs and phone numbers never reach a public page or the public read model; the admin lists them masked and shows
  them in full only on the edit form.
- `published_property_listings` no longer exposes `agency_id`, and anonymous `select` on that column was revoked.
- The only anonymous window onto `agencies` is `public_site_profile` plus column grants for those same public columns,
  behind an RLS policy limited to the active site agency. Verified over REST: private columns `42501`, `agents`,
  `admin_agents`, `admin_unlinked_senders` all `401`, admin RPCs `404`.
- All new functions are `SECURITY INVOKER` with a pinned `search_path`, `EXECUTE` revoked from `public`/`anon`/
  `authenticated` and granted to `service_role` only. RLS stays enabled everywhere.
- No mass assignment: every write function takes a whitelist and rejects unknown keys; the browser cannot name a
  column. No SQL or Storage path ever comes from a client.
- Version checks are preserved everywhere (`state_version` for listings/images, `updated_at` for agencies/agents).

## 10. Tests

Two committed regression files, both self-cleaning and both run against the live database in this phase:
`supabase/tests/phase10_agency_agent_ownership.test.sql` (36 assertions, `zz-phase10-selftest`) and
`supabase/tests/phase10_status_command_ownership.test.sql` (4 assertions, `zz-phase10-cmd`). Each raises on the first
mismatch; both executed clean and left 0 rows behind.

| # | Test | Label | Result |
| --- | --- | --- | --- |
| A | agency create / update / stale / unknown field / placeholder refused | LIVE database | PASS |
| B | agent create / update | LIVE database | PASS |
| C | agent deactivate (messages still stored, no mutation) | LIVE database | PASS |
| D | BSUID assignment (+ link from a stored message) | LIVE database | PASS |
| E | duplicate BSUID rejected | LIVE database | PASS |
| F | identity conflict rejected (also duplicate WhatsApp phone) | LIVE database | PASS |
| G | inactive agent cannot mutate (`agent_inactive`, no draft) | LIVE database | PASS |
| H | draft editable | LIVE database | PASS |
| I | rejected draft corrected → back to pending | LIVE database | PASS |
| J | approved draft edited → back to pending | LIVE database | PASS |
| K | published edit: safe edit applies; unsafe edit saves nothing; pre-existing blocker does not block | LIVE database | PASS |
| L | stale edit rejected | LIVE database | PASS |
| M | duplicate edit safe (`unchanged`, no version bump) | LIVE database | PASS |
| N | invalid field / type / length / enum / fraction rejected | LIVE database | PASS |
| O | cross-agency edit (agency_id in payload) rejected | LIVE database | PASS |
| P | ownership, provenance, slug, lifecycle, review, `state_version`, metadata not editable | LIVE database | PASS |
| Q | image reassignment rejected (foreign, partial, duplicate, foreign cover) | LIVE database | PASS |
| R | image order + cover change safe, repeat is a no-op, stale rejected | LIVE database | PASS |
| S | lifecycle actions still work (approve, publish, sold, relist, archive guards) | LIVE database | PASS |
| T | status commands still work (parser 22/22) | LIVE database | PASS |
| U | cross-agent status command blocked (same agency, other agent) | LIVE database | PASS |
| V | cross-agency status command blocked; owner's command still applies; deactivated owner blocked | LIVE database | PASS |
| W | branding consistency (no retired brand or hard-coded contact in source) | LIVE (test) | PASS |
| X | placeholder contact detection (JS mirror + database rule) | LIVE (test) | PASS |
| Y | public route regression (32 HTTP checks + 9 anonymous REST checks) | LIVE (local production server, live database) | PASS |
| Z | legacy RSVP unchanged | LIVE database | PASS |

Additional ownership regression (this phase's correction): active agency + active agent ⇒ draft created and **no**
`agency_inactive`; inactive agent ⇒ `agent_inactive`; inactive agency ⇒ `agency_inactive`; cross-agency ⇒
`agency_mismatch`; ingestion into an inactive agency ⇒ message stored, `unresolved_sender`, no session, no property;
`property_publication_check` blocks only while the agency is inactive and clears on reactivation.

Suites: TypeScript, ESLint, production build (22 routes) — PASS · `npm test` 24/24 (media 11, config 13) ·
status-command parser 22/22 · Supabase advisors: no new findings · secret scan: clean.

**Not tested live** (unchanged from Phase 9, still BLOCKED): the admin UI against live admin data (no
`SUPABASE_SERVICE_ROLE_KEY`), n8n↔Supabase, Meta/WhatsApp end to end, real media download and Storage upload. The
admin screens were type-checked, built and verified to be session-gated; every function behind them was exercised
directly in the database.

## 11. Rollback

```sql
drop function public.admin_update_property(uuid, integer, jsonb, text),
             public.admin_arrange_property_images(uuid, integer, uuid[], uuid, text),
             public.admin_save_agency(uuid, jsonb, timestamptz, text),
             public.admin_save_agent(uuid, jsonb, timestamptz, text),
             public.admin_link_agent_identity(uuid, uuid, timestamptz, text),
             public.admin_normalize_phone(text), public.admin_constraint_field(text),
             public.contact_is_placeholder(text);
drop view public.admin_agents, public.admin_unlinked_senders, public.public_site_profile;
drop policy agencies_public_read_site_profile on public.agencies;
revoke select on public.agencies from anon, authenticated;
-- re-run ingest_whatsapp_message / property_publication_check / generate_property_draft / admin_operations_status
-- from their Phase 8/9 migrations, then:
alter table public.agencies
  drop column display_name, drop column legal_name, drop column public_phone, drop column public_whatsapp,
  drop column public_email, drop column office_address, drop column office_hours, drop column is_active,
  drop column is_site_primary;   -- drops their constraints and the is_site_primary index with them
-- restore agency_id in published_property_listings from 20260917132321 and re-grant select (agency_id) to anon.
```
Revert the admin pages, `lib/admin/management*.ts`, `lib/site/*`, `components/site/*` and the brand-driven components
from Git. The website then falls back to the working name with no contact details (it never shows placeholders).

**How the two migrations were applied to the live project** — `20260919174322_agency_agent_management` was applied as
a normal migration (DDL, views, grants, policy, functions). For `20260919215136_listing_editing`, the two new
functions were created normally, and the four *existing* functions were patched in place by re-applying the same,
anchor-asserted text edits to their deployed definitions; the committed file carries their full definitions, and every
function body's md5 was then compared with the file (6/6 identical). That migration contains no DDL, so no schema
object is in a partially applied state; migration 1's columns, constraints, index, policy, views, grants and triggers
were each verified after applying.

## 12. Known limitations

- Single shared admin password (Phase 9) — the audit records a session reference, not a person.
- No listing **creation** in the admin: listings still come from WhatsApp submissions (or, for tests, direct SQL).
- No AI-assisted or bulk editing, no update-by-WhatsApp: corrections are a human admin action, by design.
- Agency deactivation requires unpublishing its live listings first; agent deactivation does not (their published
  listings stay live and remain manageable by the admin).
- Photos cannot be removed or uploaded from the admin — only reordered; attaching stays Phase 7's pipeline.
- The site profile is one agency; a genuinely multi-agency public site would need a per-listing contact model.
- Draft gallery copies remain reachable at their exact URL (Phase 9 §11, unchanged).

## 13. Remaining production launch blockers

Unchanged from Phase 9 except where noted: service-role key, publishable key and admin credentials in the hosting
environment; the four n8n credentials; the Meta app, WhatsApp Business number and webhook subscription; **the real
agency profile and real agents (now creatable in the admin — Phase 10)**; `NEXT_PUBLIC_SITE_URL`; real imagery and
audited statistics (`MEDIA_IS_PLACEHOLDER`); the production brand name confirmed by the client.
