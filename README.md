# VIP Realty

A premium editorial property platform for VIP Realty Agency — Next.js, GSAP
ScrollTrigger, Tailwind v4.

```bash
npm install
npm run dev      # http://localhost:3000
npm run build
npm run lint
npm run media    # regenerate placeholder imagery and video

npm run media:photos -- <folder>                     # install listing photos
npm run media:video -- scrub <file.mp4> --trim 1.5   # install real footage
```

Property listings are read from Supabase. Set `NEXT_PUBLIC_SUPABASE_URL` and
`SUPABASE_PUBLISHABLE_KEY` in `.env.local` (see `.env.example`); without them
the listing pages show an "unavailable" state.

## Viewing bookings

Guests book a property viewing from the listing page; the agency manages every
viewing at `/admin`. Availability, double-booking protection and the
Asia/Yerevan timezone are all resolved in Postgres, so no client can book a
slot that is taken.

**Before this runs against the real database**, paste the Supabase service-role
key into `.env.local` and set a real `ADMIN_PASSWORD`:

```
SUPABASE_SERVICE_ROLE_KEY=
ADMIN_PASSWORD=
```

Without the key the site falls back to a file-backed development store and says
so in the booking panel and admin sidebar. Full setup, including Telegram and
the 24-hour reminder job: **[docs/booking-system.md](docs/booking-system.md)**.

## What is real and what is placeholder

Placeholder content is deliberately marked so nothing accidental reaches
production:

| Placeholder | Where to replace it |
| --- | --- |
| Collection images, team photo, floor plan, map | `public/media/**` — see `public/media/README.md` |
| Company statistics (1,500+ etc.) | `site.stats` in `lib/site.ts` — flagged with `placeholder: true`, shown with a `*` and a footnote |
| Phone, WhatsApp, email, address | `site.contact` in `lib/site.ts` |
| District map geometry | `MAP_SHAPES` in `components/YerevanMap.tsx` — abstract shapes, not real outlines |
| Logo lockup | `components/ui/Logo.tsx` — inline SVG drawn to the brand; swap in the agency's artwork |

The hero still, the three section 02 intent loops, the six listing photographs
and the section 04 scrub clip are **real supplied media**,
recorded in `public/media/installed.json`; the generator skips anything listed
there, so regenerating placeholders can never overwrite them. The hero is art
directed — `hero.jpg` (2560×1440) for wide viewports, `hero-portrait.jpg` for
phones — because the supplied render is portrait and a 16:9 crop of it loses
the building on a narrow screen.

The footer says "placeholder imagery, contact details and statistics" while
`MEDIA_IS_PLACEHOLDER` is `true` in `lib/media.ts`. Flip it to `false` once
real assets are in.

## Structure

```
app/
  (site)/                   the public site — navbar, footer, scroll motion
    page.tsx                the nine-section homepage
    properties/page.tsx     filterable index
    properties/[slug]/      reusable property detail page
    viewings/[reference]/   a customer's own booking, opened from a reminder
  admin/                    viewing management, its own shell, password gated
  api/                      availability, bookings, admin, reminder job
components/
  Navbar  Hero  PropertySearch  PropertyFeature  NextAddress
  TransformationSection  PropertyCollection  AboutSection
  PropertyMap  YerevanMap  FeaturedProperty  FinalCTA  Footer
  PropertyDetail  PropertyGallery  ContactPanel  PropertyFilters
  MotionRoot                site-wide scroll reveals
  booking/                  the customer booking panel and calendar
  admin/                    the admin screens
lib/
  listings/                 Supabase listing queries, row mapper, types, filters, vocabulary
  supabase/                 server-only clients (public read, service role)
  properties.ts             LEGACY hard-coded listings, used only by booking (removed in Phase 3)
  media.ts                  every asset path in one place
  site.ts                   company copy, contact, stats, navigation
  motion.ts                 GSAP setup, reduced-motion guards, hooks
  booking/                  store interface, Supabase + dev stores, time, rules
  notifications/            outbox events, Telegram, dispatch
  env.ts                    server-only configuration
supabase/
  migrations/               schema, slot functions, RLS, cron
  functions/                the reminder edge function
scripts/media/              the placeholder generator
```

## Data

Supabase is the source of truth for property listings. Pages query the
`published_property_listings` view server-side (`lib/listings/queries.ts`) with
the publishable key, so only published listings are ever readable; rows are
validated and mapped once in `lib/listings/mappers.ts`. Filtering runs in the
database from the URL, and pages render per request, so a listing published in
Supabase appears without a rebuild. See
`docs/rebuild/phase-02-nextjs-data-layer.md`.

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
