import Image from "next/image";
import Link from "next/link";
import { PropertyGallery } from "@/components/PropertyGallery";
import { BookViewingButton } from "@/components/booking/BookViewingButton";
import { ContactPanel } from "@/components/ContactPanel";
import { YerevanMap } from "@/components/YerevanMap";
import { ArrowLink } from "@/components/ui/ArrowLink";
import { media } from "@/lib/media";
import { PROPERTIES, formatPrice, type Property } from "@/lib/properties";

/* ----------------------------------------------------------------------------
   Reusable property detail page. Everything it renders comes from one Property
   record, so a new listing needs no new markup.
---------------------------------------------------------------------------- */

export function PropertyDetail({ property }: { property: Property }) {
  const facts = [
    { label: "Type", value: property.typeLabel },
    { label: "Area", value: `${property.area.toLocaleString("en-US")} m²` },
    ...(property.bedrooms ? [{ label: "Bedrooms", value: String(property.bedrooms) }] : []),
    ...(property.bathrooms ? [{ label: "Bathrooms", value: String(property.bathrooms) }] : []),
    ...(property.floor ? [{ label: "Floor", value: property.floor }] : []),
    ...(property.year ? [{ label: "Built", value: String(property.year) }] : []),
  ];

  const more = PROPERTIES.filter((p) => p.slug !== property.slug).slice(0, 3);

  return (
    <article data-nav-tone="dark" className="bg-ink text-ivory">
      {/* hero */}
      <header className="relative flex h-[78svh] min-h-[30rem] items-end overflow-hidden bg-black">
        <div className="media-fill">
          <Image
            src={property.media.wide}
            alt={property.name}
            fill
            sizes="100vw"
            priority
            className="object-cover"
          />
        </div>
        <div className="pointer-events-none absolute inset-0 scrim-full" aria-hidden />

        <div className="shell relative w-full pb-[clamp(2rem,6vh,4rem)]">
          <nav aria-label="Breadcrumb" className="label text-ivory/50">
            <Link href="/properties" className="link-underline">Properties</Link>
            <span className="mx-3 opacity-50">/</span>
            <span className="text-champagne">{property.index}</span>
          </nav>

          <h1 data-reveal="up" className="display-lg mt-5 max-w-[14ch]">{property.name}</h1>

          <div className="mt-7 flex flex-wrap items-end justify-between gap-6 border-t border-ivory/15 pt-6">
            <div>
              <p className="label text-ivory/70">{property.city} · {property.districtLabel}</p>
              <p className="mt-3 font-display text-[1.9rem] leading-none text-champagne">{formatPrice(property)}</p>
            </div>
            <div className="w-full sm:w-auto sm:min-w-[16rem]">
              <BookViewingButton property={property} />
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

          <section className="mt-12">
            <h2 data-reveal="up" className="display-sm">{property.summary}</h2>
            <div className="mt-6 max-w-[62ch] space-y-5">
              {property.description.map((para) => (
                <p key={para} data-reveal="up" className="text-[0.98rem] font-light leading-relaxed text-ivory/70">
                  {para}
                </p>
              ))}
            </div>
          </section>

          <section className="mt-16">
            <h2 className="label text-ivory/40">Gallery</h2>
            <div className="mt-6">
              <PropertyGallery images={[property.media.wide, ...property.media.gallery]} name={property.name} />
            </div>
          </section>

          <section className="mt-16">
            <h2 className="label text-ivory/40">Features</h2>
            <ul className="mt-6 grid gap-x-10 gap-y-3 sm:grid-cols-2">
              {property.features.map((f) => (
                <li key={f} className="flex items-baseline gap-3 border-b border-ivory/10 pb-3 label text-ivory/75">
                  <span className="text-champagne" aria-hidden>—</span>
                  {f}
                </li>
              ))}
            </ul>
          </section>

          <section className="mt-16 grid gap-10 md:grid-cols-2">
            <div>
              <h2 className="label text-ivory/40">Floor plan</h2>
              <div className="mt-6 bg-ivory p-4">
                <Image
                  src={media.floorPlan}
                  alt={`Floor plan for ${property.name} (placeholder)`}
                  width={1400}
                  height={1000}
                  loading="lazy"
                  className="h-auto w-full"
                />
              </div>
              <p className="label mt-3 text-ivory/30">Placeholder plan · replace per listing</p>
            </div>

            <div>
              <h2 className="label text-ivory/40">Location</h2>
              <div className="mt-6">
                <YerevanMap selected={property.district} pins={[property]} activeSlug={property.slug} />
              </div>
              <p className="label mt-3 text-ivory/50">{property.districtLabel}, {property.city}</p>
            </div>
          </section>
        </div>

        <ContactPanel property={property} />
      </div>

      {/* more */}
      <section className="shell border-t border-ivory/12 py-16 lg:py-20">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <h2 className="display-sm">More from the selection</h2>
          <ArrowLink href="/properties">All properties</ArrowLink>
        </div>

        <ul className="mt-10 grid gap-8 md:grid-cols-3">
          {more.map((p) => (
            <li key={p.slug}>
              <Link href={`/properties/${p.slug}`} className="group block">
                <div className="relative aspect-[4/3] overflow-hidden bg-black">
                  <Image
                    src={p.media.wide}
                    alt={p.name}
                    fill
                    sizes="(max-width: 768px) 100vw, 30vw"
                    loading="lazy"
                    className="img-zoom object-cover"
                  />
                </div>
                <p className="label mt-4 text-champagne">{p.index} · {p.districtLabel}</p>
                <h3 className="display-sm mt-2 text-[1.4rem]">
                  <span className="link-underline">{p.name}</span>
                </h3>
                <p className="label mt-2 text-ivory/50">{formatPrice(p)}</p>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </article>
  );
}
