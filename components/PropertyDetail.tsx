import Image from "next/image";
import Link from "next/link";
import { PropertyGallery } from "@/components/PropertyGallery";
import { ContactPanel } from "@/components/ContactPanel";
import { YerevanMap } from "@/components/YerevanMap";
import { InquiryButton } from "@/components/inquiry/InquiryButton";
import { ArrowLink } from "@/components/ui/ArrowLink";
import { formatArea, formatPrice, locationLine } from "@/lib/listings/format";
import type { Listing } from "@/lib/listings/types";

/* ----------------------------------------------------------------------------
   Reusable property detail page. Everything it renders comes from one published
   Supabase listing, so a new listing needs no new markup. Facts that are not
   known are left out rather than shown as zero or placeholder values. The
   actions are contact actions: request information, call and WhatsApp.
---------------------------------------------------------------------------- */

export function PropertyDetail({
  listing,
  related,
}: {
  listing: Listing;
  related: Listing[];
}) {
  // Only public, display-ready values go to the client-side inquiry panel.
  const inquiry = {
    slug: listing.slug,
    name: listing.name,
    location: locationLine(listing),
    price: formatPrice(listing),
  };
  const facts = [
    { label: "Type", value: listing.typeLabel },
    ...(listing.area !== null ? [{ label: "Area", value: formatArea(listing.area) }] : []),
    ...(listing.landArea !== null ? [{ label: "Land", value: formatArea(listing.landArea) }] : []),
    ...(listing.rooms !== null ? [{ label: "Rooms", value: String(listing.rooms) }] : []),
    ...(listing.bedrooms !== null ? [{ label: "Bedrooms", value: String(listing.bedrooms) }] : []),
    ...(listing.bathrooms !== null ? [{ label: "Bathrooms", value: String(listing.bathrooms) }] : []),
    ...(listing.floor !== null ? [{ label: "Floor", value: listing.floor }] : []),
    ...(listing.year !== null ? [{ label: "Built", value: String(listing.year) }] : []),
  ];

  const cover = listing.media.cover;

  return (
    <article data-nav-tone="dark" className="bg-ink text-ivory">
      {/* hero */}
      <header className="relative flex h-[78svh] min-h-[30rem] items-end overflow-hidden bg-black">
        {cover && (
          <div className="media-fill">
            <Image
              src={cover.url}
              alt={cover.alt}
              fill
              sizes="100vw"
              priority
              className="object-cover"
            />
          </div>
        )}
        <div className="pointer-events-none absolute inset-0 scrim-full" aria-hidden />

        <div className="shell relative w-full pb-[clamp(2rem,6vh,4rem)]">
          <nav aria-label="Breadcrumb" className="label text-ivory/50">
            <Link href="/properties" className="link-underline">Properties</Link>
            <span className="mx-3 opacity-50">/</span>
            <span className="text-champagne">{listing.typeLabel}</span>
          </nav>

          <h1 data-reveal="up" className="display-lg mt-5 max-w-[14ch]">{listing.name}</h1>

          <div className="mt-7 flex flex-wrap items-end justify-between gap-6 border-t border-ivory/15 pt-6">
            <div>
              <p className="label text-ivory/70">{locationLine(listing)}</p>
              <p className="mt-3 font-display text-[1.9rem] leading-none text-champagne">{formatPrice(listing)}</p>
            </div>
            <div className="w-full sm:w-auto sm:min-w-[16rem]">
              <InquiryButton listing={inquiry} />
            </div>
          </div>
        </div>
      </header>

      <div className="shell grid gap-14 py-16 lg:grid-cols-[1fr_21rem] lg:gap-20 lg:py-24">
        {/* main column */}
        <div className="min-w-0">
          <dl className="grid grid-cols-2 gap-y-7 border-b border-ivory/12 pb-10 sm:grid-cols-3">
            {facts.map((f) => (
              <div key={f.label} data-reveal="up">
                <dt className="label text-ivory/40">{f.label}</dt>
                <dd className="mt-2 font-display text-[1.45rem] leading-none">{f.value}</dd>
              </div>
            ))}
          </dl>

          {listing.description.length > 0 && (
            <section className="mt-12">
              <div className="max-w-[62ch] space-y-5">
                {listing.description.map((para, i) => (
                  <p key={i} data-reveal="up" className="text-[0.98rem] font-light leading-relaxed text-ivory/70">
                    {para}
                  </p>
                ))}
              </div>
            </section>
          )}

          {listing.media.images.length > 0 && (
            <section className="mt-16">
              <h2 className="label text-ivory/40">Gallery</h2>
              <div className="mt-6">
                <PropertyGallery images={listing.media.images} name={listing.name} />
              </div>
            </section>
          )}

          {listing.features.length > 0 && (
            <section className="mt-16">
              <h2 className="label text-ivory/40">Features</h2>
              <ul className="mt-6 grid gap-x-10 gap-y-3 sm:grid-cols-2">
                {listing.features.map((f) => (
                  <li key={f} className="flex items-baseline gap-3 border-b border-ivory/10 pb-3 label text-ivory/75">
                    <span className="text-champagne" aria-hidden>—</span>
                    {f}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="mt-16 max-w-xl">
            <h2 className="label text-ivory/40">Location</h2>
            {listing.map && (
              <div className="mt-6">
                <YerevanMap
                  selected={listing.map.district}
                  pins={[{ slug: listing.slug, map: listing.map }]}
                  activeSlug={listing.slug}
                />
              </div>
            )}
            <p className={`label text-ivory/50 ${listing.map ? "mt-3" : "mt-6"}`}>
              {[listing.districtLabel, listing.city].filter(Boolean).join(", ")}
            </p>
          </section>
        </div>

        <ContactPanel listing={listing} inquiry={inquiry} />
      </div>

      {/* more */}
      {related.length > 0 && (
        <section className="shell border-t border-ivory/12 py-16 lg:py-20">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <h2 className="display-sm">More from the selection</h2>
            <ArrowLink href="/properties">All properties</ArrowLink>
          </div>

          <ul className="mt-10 grid gap-8 md:grid-cols-3">
            {related.map((p) => (
              <li key={p.slug}>
                <Link href={`/properties/${p.slug}`} className="group block">
                  <div className="relative aspect-[4/3] overflow-hidden bg-black">
                    {p.media.cover && (
                      <Image
                        src={p.media.cover.url}
                        alt={p.media.cover.alt}
                        fill
                        sizes="(max-width: 768px) 100vw, 30vw"
                        loading="lazy"
                        className="img-zoom object-cover"
                      />
                    )}
                  </div>
                  <p className="label mt-4 text-champagne">{p.typeLabel} · {p.districtLabel ?? p.city}</p>
                  <h3 className="display-sm mt-2 text-[1.4rem]">
                    <span className="link-underline">{p.name}</span>
                  </h3>
                  <p className="label mt-2 text-ivory/50">{formatPrice(p)}</p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}
