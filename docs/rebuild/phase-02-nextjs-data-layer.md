# Phase 2 — Next.js Data Layer Migration

Status: **complete**. Branch `phase/02-nextjs-data-layer` (from Phase 1 commit `0ad1697`).

> **Supabase is now the source of truth for the public property data path.** The homepage listing
> sections, the properties index, filters, the detail page, featured listings, the map and the
> neighbourhood/search options all read published listings from Supabase at request time.
>
> **A legacy path still depends on `lib/properties.ts`:** the booking system (its development store and
> its `Property` prop type) and the legacy photo installer. That file is no longer used for any public
> listing data and is removed with booking in Phase 3.

No secrets or environment values appear in this document.

---

## 1. Old data flow

```text
Next.js page (static / SSG)
   ↓
lib/properties.ts → hard-coded PROPERTIES (6 listings)
   ↓
local images in public/media/properties/
   ↓
filtering in the browser (filterProperties over the full array)
```

`/properties/[slug]` was prebuilt with `generateStaticParams`, so a new listing required a code change
and a rebuild. `scripts/db/sync-properties.mjs` pushed the array into Supabase for the booking system.

## 2. New data flow

```text
Browser ── request ──▶ Next.js server component (rendered per request)
                            ↓
                  lib/listings/queries.ts   (server-only)
                            ↓  publishable key, cache: no-store, 8 s timeout
                  Supabase REST → published_property_listings (view)
                            ↓  RLS: listing_status = 'published', public columns only
                  lib/listings/mappers.ts   (validate + normalize once)
                            ↓
                  Listing objects (public fields only) → components → HTML
Images: property_images (in the view) → public URL in Supabase Storage bucket `property-images`
        → next/image
```

The browser never talks to Supabase and never receives a key: it receives rendered HTML and the
serialized public `Listing` props of client components.

## 3. Files changed

| File | Change |
| --- | --- |
| `lib/supabase/public.ts` | **new** — server-only least-privilege client (publishable key, `no-store`, timeout) |
| `lib/listings/types.ts` | **new** — public `Listing` model (client-safe types) |
| `lib/listings/taxonomy.ts` | **new** — website vocabulary: property-type labels, collections, filter options, stylized-map districts, `placeId`, feature labels |
| `lib/listings/format.ts` | **new** — `formatPrice` (multi-currency), `metaLine`, `formatArea`, `locationLine`, `positionLabel` |
| `lib/listings/filters.ts` | **new** — URL search-param contract, parsed and validated |
| `lib/listings/mappers.ts` | **new** — server-only row → `Listing` mapper, selected columns, image URL builder |
| `lib/listings/queries.ts` | **new** — server-only queries (search, by slug, recent, featured, related, facets, category counts) |
| `lib/listings/legacy-booking.ts` | **new** — legacy bridge: booking record for a slug when the booking system knows it |
| `lib/env.ts` | added `SUPABASE_PUBLISHABLE_KEY` and `hasPublicSupabase()` |
| `app/(site)/layout.tsx` | loads district facets for navbar search and footer |
| `app/(site)/page.tsx` | loads recent, featured, category counts and facets |
| `app/(site)/properties/page.tsx` | URL → server-side search → results |
| `app/(site)/properties/[slug]/page.tsx` | query by slug; `generateStaticParams` removed; not-found for unpublished |
| `app/(site)/error.tsx` | **new** — generic "temporarily unavailable" error boundary |
| `components/PropertiesIndex.tsx` | renders server results; filter changes update the URL (no in-browser filtering) |
| `components/PropertyFilters.tsx` | district options from Supabase facets; types from `lib/listings` |
| `components/Navbar.tsx`, `components/PropertySearch.tsx`, `components/Footer.tsx` | district options as props |
| `components/NextAddress.tsx`, `components/PropertyFeature.tsx` | listings as props; editorial index is the list position; empty state; count copy derived from data |
| `components/FeaturedProperty.tsx` | featured listing as prop; unknown facts omitted |
| `components/PropertyCollection.tsx` | per-collection counts from Supabase |
| `components/PropertyMap.tsx`, `components/YerevanMap.tsx` | listings as props; pins at district map positions |
| `components/PropertyDetail.tsx`, `components/ContactPanel.tsx`, `components/PropertyGallery.tsx` | Supabase listing, related listings, gallery from `property_images`; booking only where bookable |
| `next.config.ts` | `images.remotePatterns` for the project's `property-images` bucket path |
| `.env.example` | `SUPABASE_PUBLISHABLE_KEY=` placeholder |
| `lib/properties.ts` | header comment only: marked LEGACY and not the source of truth |
| `scripts/db/sync-properties.mjs` | **deleted** |
| `package.json` | `db:sync` script removed |
| `README.md`, `docs/booking-system.md` | data-source documentation updated; sync script references removed |

## 4. Property mapper architecture

`lib/listings/mappers.ts` is the single boundary between database rows and UI:

* **Selected columns only** (`LISTING_COLUMNS`): id, slug, title, description, intent, property_type,
  country, city, district, price, currency, price_period, price_negotiable, area_sqm, land_area_sqm,
  rooms, bedrooms, bathrooms, floor, total_floors, year_built, features, featured, published_at,
  images. Not selected: agency_id, address, coordinates, metadata, agent, review/source/session fields,
  legacy booking columns.
* **Required for a published listing:** id, slug, title, intent, property_type, city, price > 0, currency.
  A row missing any of these is **skipped and logged by id** — never rendered with invented values.
  (The database already refuses to publish such rows; this is defence in depth.)
* **Normalization in one place:** enums validated against allowed sets; numerics accepted as numbers
  (or numeric strings); integers checked; images JSON validated item by item; feature codes validated
  and turned into labels (`air_conditioning` → "Air conditioning"); description split into paragraphs;
  floor rendered as "5 of 9" / "5" / unknown.
* **Unknown stays unknown:** `null` values are omitted by components ("0 bedrooms" is never shown for
  an unknown count, no "null m²", no placeholder floor plan).

`Listing` field mapping to the previous UI model:

| Previous UI field | New source |
| --- | --- |
| `name` | `title` |
| `intent` (buy/rent/land) | `property_type = land` → `land`, otherwise `intent` |
| `category` | derived from `property_type` (garage/other → none) |
| `typeLabel` | label of `property_type` |
| `city`, `districtLabel`, `district` | `city`, `district`, URL id of the district |
| `price`, `period` | `price`, `currency`, `price_period` |
| `area`, `bedrooms`, `bathrooms`, `year` | `area_sqm` (+ `land_area_sqm`), `bedrooms`, `bathrooms`, `year_built` (nullable) |
| `floor` | `floor` + `total_floors` |
| `description`, `features`, `featured` | `description` (paragraphs), `features` (labels), `featured` |
| `media.wide / portrait / gallery` | `media.cover` (primary image, else first) and `media.images` |
| `map {x,y}` | stylized-map position of the listing's district, if the map draws it |
| `index` ("01") | position in the rendered list |
| `summary` | none in the database; the index shows the first description paragraph instead, the detail page shows the description |

## 5. Image architecture

* Images come from `property_images` rows, aggregated per listing by the `published_property_listings`
  view (one query, no N+1).
* Public URL is deterministic: `{NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/property-images/{storage_path}`.
  Paths must match `properties/{uuid}/{file}.{jpg|jpeg|png|webp|avif}`; anything else is dropped.
* Order: ascending `sort_order`. Cover: the `is_primary` image, else the first image.
* Alt text: `alt_text`, else "{title}, image N".
* Missing images: sections render without an image (dark frame) or the gallery is omitted. No fake URLs.
* `next.config.ts` allows only that bucket path on the configured project host for `next/image`.
* Local images under `public/media/properties/` were **not deleted**; they are no longer used by the
  public listing path (only by legacy booking's panel header for the six legacy slugs).

## 6. Filtering architecture

```text
URL ─▶ parseListingSearch() ─▶ searchListings() ─▶ Supabase query ─▶ matching published listings
 ▲                                                                            │
 └──── PropertiesIndex: filter change → router.replace(URL) ◀──── server re-render
```

URL contract (unchanged parameters kept):

| Param | Values | Database filter |
| --- | --- | --- |
| `intent` | `buy`, `rent`, `land` | buy/rent → `intent = …` and not land (as before); land → `property_type = land` |
| `type` | `apartments`, `houses`, `land`, `commercial` | `property_type IN (…)` |
| `district` | district URL id (e.g. `arabkir`) | resolved to the published spelling(s) via facets → `district IN (…)` |
| `price` | `0-150`, `150-300`, `300-600`, `600+` | USD sale prices: `price_period IS NULL AND currency = USD AND price BETWEEN …`; not applied to rent searches (previous rule) |
| `bedrooms` | `1`–`4` (minimum) | `bedrooms >= n` (unknown excluded) |
| `city` *(new, no UI yet)* | city URL id | `city IN (…)` |
| `area_min`, `area_max` *(new, no UI yet)* | integers | `area_sqm >= / <=` |

Invalid values are ignored. Ordering: featured first, newest published, then slug. District options in
all filter UIs are the districts that currently have published listings (no hard-coded district list).

## 7. Rendering / caching decision

| Question | Answer |
| --- | --- |
| Are listing pages dynamic? | Yes. `/`, `/properties` and `/properties/[slug]` render per request (`connection()` in the query layer; build output shows ƒ). The `(site)` layout also queries facets, so all public site pages are request-time. |
| Are queries cached? | No. The Supabase client fetches with `cache: "no-store"`. Within one request, facets and the slug lookup are de-duplicated with React `cache()`. |
| Revalidation duration | None (no data cache). |
| How does a newly published property become visible? | On the next page request after `listing_status` becomes `published` — no rebuild, redeploy or restart (verified, §13 Test L). |
| How does an update become visible? | Same: the next request reads the current row. Unpublishing is immediate too (the detail page returns 404). |
| `generateStaticParams` | Removed. |

For V1, freshness is preferred over caching. A later phase can add tag-based caching with on-demand
revalidation triggered by automation.

## 8. Error handling

| Situation | Behaviour |
| --- | --- |
| Supabase not configured (no URL/key) | One server warning; index shows "Listings are temporarily unavailable"; homepage listing sections show empty states; detail page shows the generic error page |
| Supabase unreachable / query error / invalid key | Logged as `[listings] <operation> failed { code, message }`; same degradation as above |
| Request hangs | Each request is aborted after 8 s → treated as unavailable |
| Malformed row | Skipped, logged by id |
| Unpublished / nonexistent / malformed slug | Standard Next.js not-found (404) |
| Missing image or optional field | Omitted from the UI |
| No featured listing | Featured section omitted (no fallback to another listing) |

Internal error messages are never rendered: the detail page throws a generic error, production responses
carry only a digest, and `app/(site)/error.tsx` shows "We couldn't load this page" (verified in a browser).

## 9. Security boundary

* Public reads use the **publishable key server-side only** (`SUPABASE_PUBLISHABLE_KEY`, no
  `NEXT_PUBLIC_` prefix, read in `server-only` modules). The **service-role key is not used** by the
  listing path; it remains booking-only and server-only.
* The database enforces the publishing boundary (RLS + column grants + the published view). The website
  also queries the published view, never raw `properties` rows.
* Verified (§13): no key, secret variable name, or listing query code in client bundles; the browser made
  no requests to Supabase; with the publishable key, direct REST access to WhatsApp messages/media,
  extraction results, agents, agencies, sessions, inquiries and automation events is denied, drafts are
  not returned, the `address` column and `select=*` on `properties` are denied, and inserts are denied.
  Rendered pages contain no address, review status, metadata or agency id. Server logs contain no key
  material.

## 10. `lib/properties.ts` status

**Kept temporarily as a legacy module** (header marked LEGACY). No public listing data comes from it.
Remaining dependents:

| Dependent | Why | Removed in |
| --- | --- | --- |
| `lib/booking/index.ts` | development booking store is built from `PROPERTIES` | Phase 3 |
| `components/booking/BookingPanel.tsx`, `BookViewingButton.tsx` | `Property` prop type | Phase 3 |
| `lib/listings/legacy-booking.ts` (+ type imports in `PropertyDetail`, `ContactPanel`) | offer booking only for slugs the booking system knows | Phase 3 |
| `scripts/media/install-photos.mjs` | legacy local photo installer reads the file | Phase 3 (replaced by the Storage media pipeline) |
| `app/admin/(protected)/properties/page.tsx` | subtitle text mentions the file (booking admin) | Phase 3 |

## 11. `scripts/db/sync-properties.mjs` status

**Deleted.** It pushed the hard-coded array into Supabase — the opposite of the new direction — and was
already incompatible with the Phase 1 property checks. Its `db:sync` npm script and the README /
booking-doc references were removed. No code referenced it.

## 12. Booking compatibility

* All booking APIs, components, admin screens, viewing pages, tables, functions and reminders are
  unchanged and still build; `/api/availability`, `/api/bookings` validation and `/admin/login` were
  exercised at runtime.
* The booking system only knows the six legacy slugs. Those rows are Supabase drafts, so their public
  detail pages now return 404 and the "Book a viewing" action is not reachable from the public site.
  For any published listing whose slug matches a legacy booking record, the booking action is still
  offered (via `legacy-booking.ts`). New Supabase listings do not offer booking, because booking cannot
  work for them. This is intentional until booking is removed in Phase 3.
* The booking panel still uses its legacy local header image for those slugs.

## 13. Tests performed

Environment: local production build (`next build` + `next start`) against the connected Supabase
project, using the project's publishable key supplied to the test process only (not written to any
repository or env file).

Because no published listings exist (the six legacy rows remain drafts, untouched), **temporary test
rows** were committed and removed afterwards: one test agency, published apartment (rent, Arabkir,
featured, 3 images with non-sequential `sort_order`, primary image in the middle, private address and
metadata), published house (buy, Avan, most optional fields NULL, no images), published land (Ajapnyak,
land area only), and a **featured draft** apartment with an image. All used `zz-phase2-*` slugs and
`metadata.test = phase2`. After testing, all test rows were deleted and verified gone; the six legacy
listings and the RSVP data matched their pre-test fingerprints; published listings back to 0; no storage
objects. No real image files were uploaded, so test image requests themselves return errors from Storage;
URL construction and ordering were verified in the HTML.

| Test | Result |
| --- | --- |
| A — draft not public (index, homepage) | **PASS** |
| B — published listings appear (3 of 3) | **PASS** |
| C — published listing by slug (fields, price, floor, features, description, metadata title) | **PASS** |
| D — draft slug, legacy draft slug, unknown slug, invalid slug → 404 | **PASS** (4/4) |
| E — gallery order follows `sort_order`; hero uses primary image; Storage URL via `next/image` | **PASS** (3/3) |
| F — homepage featured = published featured listing; featured draft excluded | **PASS** |
| G — intent rent / buy (land excluded) / land | **PASS** (3/3) |
| H — type houses / apartments (draft excluded) / land / commercial (none) | **PASS** (4/4) |
| I — district arabkir / avan / kentron (draft only → 0) / city yerevan / unknown district | **PASS** (5/5) |
| J — price bands, rent ignores sale band, bedrooms 2+/3+, area min/max, combined filters, invalid params ignored | **PASS** (9/9) |
| K — null optional fields render cleanly; land listing omits unknown area/bedrooms; no null/undefined/NaN output | **PASS** (3/3) |
| L — with the server running (no rebuild, no restart): new published listing appears on index, detail, homepage and as a new district filter; price update visible on next request; unpublishing → 404 and removed from index | **PASS** (8/8) |
| M — build contains all booking routes; `/api/availability` 200, `/api/bookings` validation 422, `/admin/login` 200 | **PASS** (3/3) |
| Security — REST with publishable key (8 private tables denied, drafts not returned, address and `select=*` denied, insert denied, draft images not readable); bundles and logs free of keys; pages free of address/review/metadata/agency id | **PASS** |
| Errors — invalid key and missing key: index shows unavailable state (200), homepage empty states (200), detail 500 with generic page and no internal text; booking API unaffected | **PASS** |
| Browser — filter selection updates URL and server results; no browser requests to Supabase; error page rendered to visitors | **PASS** |

`npm run lint`: 0 errors. `npm run build`: success; `/`, `/properties`, `/properties/[slug]` dynamic; all
booking/admin routes present. `tsc --noEmit`: clean.

## 14. Known limitations

1. **Local listing reads need `SUPABASE_PUBLISHABLE_KEY` in `.env.local`.** It is not set in the current
   local file, so `npm run dev` shows the "temporarily unavailable" state until it is added (a public,
   RLS-restricted key, but still configuration only the owner should add).
2. **No published listings exist.** The public site currently shows empty states; this is expected until
   real listings are published.
3. The index returns at most **200** listings (no pagination UI yet); facets read up to 1,000 rows and
   category counts up to 5,000 rows.
4. Price bands filter **USD sale prices only**; listings in other currencies are excluded from banded
   searches.
5. District filtering uses URL ids derived from Latin-script district names; districts stored in other
   scripts have no filter option until names are normalized (automation phase).
6. Map pins sit at the **district's** position on the stylized map; several listings in one district
   overlap, and districts the map does not draw have no pin.
7. The placeholder floor plan was removed from detail pages (no floor-plan data exists).
8. Every public page now performs Supabase requests per visit (no data cache). Acceptable for V1; add
   tag-based caching with on-demand revalidation later if needed.
9. The booking action is only offered for the six legacy slugs (see §12).
10. `lib/media.ts` still contains legacy per-slug media helpers used only by `lib/properties.ts`.
11. The admin "Properties" screen is still the booking viewing-mode screen and reads the legacy data.

## 15. Next phase

**Phase 3 — Remove Booking System & Repurpose Site/Admin Around Listings.** Not started.
