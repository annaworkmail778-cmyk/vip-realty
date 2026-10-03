import Link from "next/link";
import Image from "next/image";
import { PropertyGallery } from "@/components/PropertyGallery";
import { PropertyCard } from "@/components/PropertyCard";
import { ContactPanel } from "@/components/ContactPanel";
import { YerevanMap } from "@/components/YerevanMap";
import { StickyContactBar } from "@/components/inquiry/StickyContactBar";
import { ArrowLink } from "@/components/ui/ArrowLink";
import { getDictionary } from "@/lib/i18n/get-dictionary";
import type { Listing } from "@/lib/listings/types";

/* ----------------------------------------------------------------------------
   Reusable property detail page. Everything it renders comes from one published
   Supabase listing, so a new listing needs no new markup. Facts that are not
   known are left out rather than shown as zero or placeholder values. The
   actions are contact actions: request information, call and WhatsApp.

   Layout: photography first. A buyer arrives to look at the property, so the
   gallery opens the page rather than sitting below the description, and the
   page uses the ivory inventory surface so the images carry the contrast. The
   facts, description and features run down the left; the contact panel is
   sticky on the right. On a phone the panel is replaced by a sticky bottom bar.
---------------------------------------------------------------------------- */

export async function PropertyDetail({
  listing,
  related,
}: {
  listing: Listing;
  related: Listing[];
}) {
  const { dict, fmt } = await getDictionary();
  const title = fmt.title(listing);
  // Only public, display-ready values go to the client-side inquiry panel. The
  // dialog and the WhatsApp message print `location` next to the name, so a
  // generated title is passed without its place.
  const inquiry = {
    slug: listing.slug,
    name: fmt.title(listing, { short: true }),
    location: fmt.locationLine(listing),
    price: fmt.price(listing),
  };
  const facts = [
    { label: dict.property.type, value: fmt.type(listing) },
    ...(listing.area !== null ? [{ label: dict.property.area, value: fmt.area(listing.area) }] : []),
    ...(listing.landArea !== null ? [{ label: dict.property.landArea, value: fmt.area(listing.landArea) }] : []),
    ...(listing.rooms !== null ? [{ label: dict.property.rooms, value: String(listing.rooms) }] : []),
    ...(listing.bedrooms !== null ? [{ label: dict.property.bedrooms, value: String(listing.bedrooms) }] : []),
    ...(listing.bathrooms !== null ? [{ label: dict.property.bathrooms, value: String(listing.bathrooms) }] : []),
    // The mapper writes the floor as "5 of 9"; the formatter re-words that pair.
    ...(listing.floor !== null ? [{ label: dict.property.floor, value: fmt.floor(listing.floor) }] : []),
    ...(listing.year !== null ? [{ label: dict.property.built, value: String(listing.year) }] : []),
  ];

  /* An unknown Latin feature code is dropped in a non-English UI (see
     `fmt.feature`), so the section is driven by what actually survives rather
     than by the raw count — otherwise a listing whose features are all unknown
     would render an empty "Features" heading. */
  const features = listing.features
    .map((f) => fmt.feature(f))
    .filter((f): f is string => f !== null);

  const cover = listing.media.cover;
  const gallery = listing.media.images;
  const price = fmt.price(listing);
  const isRent = listing.intent === "rent";

  return (
    <article data-nav-tone="light" className="bg-ivory text-ink">
      <div>
        <div className="shell pt-[calc(var(--nav-h)+clamp(1.5rem,4vw,2.5rem))]">
          <nav aria-label={dict.property.breadcrumbLabel} className="label text-espresso/55">
            <Link href="/properties" className="link-underline">{dict.property.breadcrumb}</Link>
            {listing.districtLabel && (
              <>
                <span className="mx-3 opacity-40">/</span>
                {/* Only link when the district has a URL id the index can filter on. */}
                {listing.district ? (
                  <Link href={`/properties?district=${listing.district}`} className="link-underline">
                    {fmt.districtName(listing.districtLabel)}
                  </Link>
                ) : (
                  <span>{fmt.districtName(listing.districtLabel)}</span>
                )}
              </>
            )}
            <span className="mx-3 opacity-40">/</span>
            <span className="text-gold">{fmt.type(listing)}</span>
          </nav>

          {/* ---------------------------------------------------------------- gallery first */}
          <div className="mt-6">
            {gallery.length > 0 ? (
              <PropertyGallery images={gallery} name={title} variant="hero" />
            ) : cover ? (
              <div className="relative aspect-[4/5] overflow-hidden bg-ivory-3 sm:aspect-[16/9]">
                <Image src={cover.url} alt={cover.alt || title} fill sizes="100vw" priority className="object-cover" />
              </div>
            ) : null}
          </div>

          {/* ---------------------------------------------------------------- title block */}
          <header className="mt-9 border-b border-espresso/12 pb-9">
            <div className="flex flex-wrap items-center gap-3">
              <span className={`badge ${isRent ? "bg-cocoa text-ivory" : "bg-espresso text-ivory"}`}>
                {fmt.intent(listing)}
              </span>
              {listing.priceNegotiable === true && (
                <span className="badge border border-espresso/20 text-espresso">{dict.property.negotiable}</span>
              )}
              <span className="label text-espresso/50">{fmt.type(listing)}</span>
            </div>

            {/* The place is on the line below, so a generated title omits it here. */}
            <h1 data-reveal="up" className="display-lg mt-5 max-w-[18ch] text-ink">{fmt.title(listing, { short: true })}</h1>

            <div className="mt-6 flex flex-wrap items-end justify-between gap-6">
              <p className="label text-cocoa">{fmt.districtFirstLine(listing)}</p>
              <p className="price price-lg text-ink">{price}</p>
            </div>
          </header>
        </div>

        <div className="shell grid gap-14 pb-[var(--spacing-inventory)] pt-12 lg:grid-cols-[1fr_21rem] lg:gap-20">
          {/* main column */}
          <div className="min-w-0">
            <dl className="grid grid-cols-2 gap-y-7 border-b border-espresso/12 pb-10 sm:grid-cols-3">
              {facts.map((f) => (
                <div key={f.label} data-reveal="up">
                  <dt className="label text-espresso/50">{f.label}</dt>
                  <dd className="mt-2 font-display text-[1.45rem] leading-none text-ink">{f.value}</dd>
                </div>
              ))}
            </dl>

            {listing.description.length > 0 && (
              <section className="mt-12">
                <div className="max-w-[62ch] space-y-5">
                  {listing.description.map((para, i) => (
                    <p key={i} data-reveal="up" className="text-[0.98rem] font-light leading-relaxed text-espresso/85">
                      {para}
                    </p>
                  ))}
                </div>
              </section>
            )}

            {features.length > 0 && (
              <section className="mt-14">
                <h2 className="label text-espresso/50">{dict.property.features}</h2>
                <ul className="mt-6 grid gap-x-10 gap-y-3 sm:grid-cols-2">
                  {features.map((f) => (
                    <li
                      key={f}
                      className="label flex items-baseline gap-3 border-b border-espresso/10 pb-3 text-espresso/80"
                    >
                      <span className="text-gold" aria-hidden>—</span>
                      {f}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section className="mt-14 max-w-xl">
              <h2 className="label text-espresso/50">{dict.property.location}</h2>
              {listing.map && (
                <div className="mt-6">
                  <YerevanMap
                    selected={listing.map.district}
                    pins={[{ slug: listing.slug, map: listing.map }]}
                    activeSlug={listing.slug}
                  />
                </div>
              )}
              <p className={`label text-cocoa ${listing.map ? "mt-3" : "mt-6"}`}>
                {fmt.place(listing)}
              </p>
            </section>
          </div>

          <ContactPanel listing={listing} inquiry={inquiry} tone="light" />
        </div>

        {/* more */}
        {related.length > 0 && (
          <section className="shell border-t border-espresso/12 py-[var(--spacing-inventory)]">
            <div className="flex flex-wrap items-end justify-between gap-6">
              <h2 className="display-sm text-ink">{dict.property.more}</h2>
              <ArrowLink href="/properties" tone="ink">{dict.property.all}</ArrowLink>
            </div>

            <ul className="mt-10 grid gap-5 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3">
              {related.map((p) => (
                <li key={p.slug} className="flex">
                  <PropertyCard listing={p} sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 30vw" />
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <StickyContactBar listing={inquiry} price={price} />
    </article>
  );
}
