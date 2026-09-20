# VIP Realty

A premium editorial real-estate website for VIP Realty Agency — Next.js, GSAP
ScrollTrigger, Tailwind v4, with Supabase as the source of truth for listings.

```bash
npm install
npm run dev      # http://localhost:3000
npm run build
npm run lint
npm run media    # regenerate placeholder brand imagery and video
npm run media:video -- scrub <file.mp4> --trim 1.5   # install real footage
```

## Product

Visitors browse published listings and contact the agency about a property:

- **Call** and **WhatsApp** (the WhatsApp message is prefilled with the listing title and reference);
- **Request more information** — a short form that stores an inquiry in Supabase.

There is no viewing booking, scheduling or availability system.

Listings will be created from agents' WhatsApp messages through n8n automation
and AI extraction. Implemented so far (n8n workflows in `automation/n8n/`, inactive
until credentials are configured): inbound WhatsApp messages are stored in
Supabase, grouped into submission sessions, and turned into validated **extraction
results**. Valid results become **non-public property drafts** (`draft`, review
`pending`) for a human to review; reviewing and publishing them is **not
implemented yet**.

## Configuration

Copy `.env.example` to `.env.local`:

| Variable | Used for |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `SUPABASE_PUBLISHABLE_KEY` | Server-side public reads of published listings and inquiry submission (RLS-protected) |
| `SUPABASE_SERVICE_ROLE_KEY` | Admin listing management only. Server-only — never in client code or `NEXT_PUBLIC_*` |
| `ADMIN_PASSWORD_HASH` | scrypt hash of the admin password (`npm run admin:hash-password`). Required in production |
| `ADMIN_SESSION_SECRET` | Random, 32+ characters; signs admin sessions |
| `ADMIN_PASSWORD` | Local development only — ignored in production |

Production fails closed: without a valid `ADMIN_PASSWORD_HASH` and a 32+ character
`ADMIN_SESSION_SECRET`, admin sign-in is disabled. Rotating either signs every
admin out. The admin area uses a single shared password; per-user accounts are a
planned later improvement.

Check the configuration by variable name (values are never printed):

```bash
npm run check:config
npm run check:config:production
```

The second is the release gate (also checks the committed n8n workflows). See
`docs/rebuild/production-launch-checklist.md` before going live.

Without the Supabase keys the listing pages show an "unavailable" state and the
admin shows a configuration notice.

## Admin

`/admin` is password-protected operations management: **Review**, **Properties**,
**Agents**, **Agency**, **Pipeline** and **Operations**. `/admin/properties` is the
review queue (pending review, approved and rejected drafts, then published, sold,
rented and archived listings) with each draft's agent, agency, extraction state,
photos and whether it is publishable. A listing's page shows where every value
came from (WhatsApp messages, extraction evidence, media) and offers the actions
the database allows: approve, reject (with a reason), publish, mark sold / rented,
unpublish, archive and restore. `/admin/pipeline` lists held, rejected, failed and
expired media and submissions that did not become a clean draft. `/admin/operations`
shows pipeline health and configuration as counts and yes/no checks (no
messages, phone numbers or credentials). A listing's content can be corrected at
`/admin/properties/<id>/edit` (a human edit: ownership, provenance, lifecycle and
review state are never editable, an approved draft returns to review, and a live
listing is only changed if it stays publishable), and its photos reordered.
`/admin/agency` holds the agency's public profile — **the brand name and every
contact detail the website shows come from there**, not from the code — and
`/admin/agents` registers agents and their WhatsApp identities. The database
enforces every rule; photos are shown through an authenticated admin route, never
public draft URLs. Agents can also send `sold <listing link>`, `rented <listing
link>` or `archive <listing link>` on WhatsApp — see
`docs/rebuild/phase-08-review-publish-status.md`.

## What is real and what is placeholder

Placeholder content is deliberately marked so nothing accidental reaches
production:

| Placeholder | Where to replace it |
| --- | --- |
| Collection images, team photo, map | `public/media/**` — see `public/media/README.md` |
| Company statistics (1,500+ etc.) | `site.stats` in `lib/site.ts` — flagged with `placeholder: true`, shown with a `*` and a footnote |
| Phone, WhatsApp, email, address, brand name | `/admin/agency` (stored in the database, not in the code) |
| District map geometry | `MAP_SHAPES` in `components/YerevanMap.tsx` — abstract shapes, not real outlines |
| Logo lockup | `components/ui/Logo.tsx` — inline SVG drawn to the brand; swap in the agency's artwork |

The hero still, the three section 02 intent loops and the section 04 scrub clip
are **real supplied media**, recorded in `public/media/installed.json`; the
generator skips anything listed there, so regenerating placeholders can never
overwrite them. The hero is art directed — `hero.jpg` (2560×1440) for wide
viewports, `hero-portrait.jpg` for phones — because the supplied render is
portrait and a 16:9 crop of it loses the building on a narrow screen.

Listing photographs are not local files: they live in the Supabase Storage
bucket `property-images`.

The footer says "placeholder imagery, contact details and statistics" while
`MEDIA_IS_PLACEHOLDER` is `true` in `lib/media.ts`. Flip it to `false` once
real assets are in.

## Structure

```
app/
  (site)/                   the public site — navbar, footer, scroll motion
    page.tsx                the nine-section homepage
    properties/page.tsx     filterable index (server-side Supabase queries)
    properties/[slug]/      property detail page
  admin/                    listing management, password gated
  api/
    inquiries/              "request more information" submissions
    admin/login, logout     admin session
components/
  Navbar  Hero  PropertySearch  PropertyFeature  NextAddress
  TransformationSection  PropertyCollection  AboutSection
  PropertyMap  YerevanMap  FeaturedProperty  FinalCTA  Footer
  PropertyDetail  PropertyGallery  ContactPanel  PropertyFilters
  MotionRoot                site-wide scroll reveals
  inquiry/                  request-information button and panel
  admin/                    the admin screens
lib/
  listings/                 Supabase listing queries, row mapper, types, filters, vocabulary
  inquiries/                inquiry validation (shared by form and API)
  admin/                    admin auth (scrypt password, signed sessions), listing queries, diagnostics
  supabase/                 server-only clients (public read, service role)
  security/                 rate limiting, same-origin check
  media.ts                  brand asset paths
  site.ts                   company copy, stats, navigation (no brand or contacts)
  site/                     the configured agency's brand and contact details
  motion.ts                 GSAP setup, reduced-motion guards, hooks
  env.ts                    server-only configuration
supabase/
  migrations/               schema history (see docs/rebuild/)
automation/n8n/             secret-free exports of the n8n workflows
automation/prompts/         versioned AI extraction prompt and output schema
scripts/media/              the placeholder generator and footage installer
scripts/config/             configuration check (names only) and its tests
scripts/admin/              admin password hash generator
docs/rebuild/               rebuild phase records
```

## Data

Supabase is the source of truth for property listings. Pages query the
`published_property_listings` view server-side (`lib/listings/queries.ts`) with
the publishable key, so only published listings are ever readable; rows are
validated and mapped once in `lib/listings/mappers.ts`. Filtering runs in the
database from the URL, and pages render per request, so a listing published in
Supabase appears without a rebuild.

Inquiries are submitted through `/api/inquiries`, which validates the form and
calls the database function `submit_inquiry`; that function accepts only a
published listing (by slug) and writes to the private `inquiries` table.

Inbound WhatsApp messages reach Supabase through n8n, which calls the database
function `ingest_whatsapp_message` with the service role (n8n credential only).
It stores each message once, with media metadata, the agent's submission
session and an audit trail — see `docs/rebuild/phase-04-whatsapp-n8n-foundation.md`.
Senders are identified by Meta's business-scoped user id first and the registered
phone second (never the display name); unknown senders are stored but never
processed — see `docs/rebuild/phase-06-5-whatsapp-identity.md`.

A scheduled n8n workflow advances sessions (5-minute quiet period, 90-second media
settle, 60-minute cap, `done`/`cancel` commands), claims one ready session at a time
in the database, asks the AI to extract the listing fields, and records the result
through `record_extraction_result`, which validates the untrusted output
deterministically. Extraction results are append-only and never modify
`properties` — see `docs/rebuild/phase-05-session-buffering-ai-extraction.md`.

A valid extraction result then becomes exactly one property draft through the
database function `generate_property_draft` (one property per session, ownership
from the session's agent and agency, deterministic title and slug). Drafts stay
`draft` / review `pending` and are never visible on the website until a later
explicit publishing step — see `docs/rebuild/phase-06-property-draft-generation.md`.

Photos an agent sends are downloaded from WhatsApp by the n8n *Media Processing*
workflow into the private `whatsapp-media` bucket, validated from their bytes, and
copied into `property-images` only for the draft created from the same submission
session (the database decides the target, the path and the order). Draft images
appear in no public query or page — see `docs/rebuild/phase-07-media-storage.md`.

## Motion

- One `MotionRoot` owns every `data-reveal` element, batched so siblings
  stagger together instead of each firing its own trigger.
- Complex sections build their own scoped GSAP context and revert it on
  unmount, so pinned sections do not leak spacers between routes.
- Section 04 never calls `play()`. Scroll position drives `currentTime`:
  down advances, up reverses, stopping freezes. Its ScrollTrigger is created on
  mount — not when the video loads — because inserting a pin spacer into an
  already-scrolled page desyncs every trigger below it. `duration` is only read
  after `loadedmetadata`.
- Everything is skipped under `prefers-reduced-motion: reduce`, including the
  hero autoplay.

## Layout

Small screens are not a shrunk desktop. The scrubbed property sequence becomes
stacked editorial blocks, the pinned horizontal collection becomes a native
snap-scroller, and the navigation becomes a full-screen menu.

## Performance

- Only the hero poster is `priority`; everything else is lazy.
- Neither video preloads. The hero streams as it plays, and the scrub clip is
  fetched only when the section is about a viewport away.
- Both clips ship as WebM and MP4 with poster frames.
