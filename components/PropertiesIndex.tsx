"use client";

import { useState, useTransition } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PropertyFilters, filtersToQuery, type FilterState } from "@/components/PropertyFilters";
import { ArrowLink } from "@/components/ui/ArrowLink";
import { formatPrice, locationLine, metaLine, positionLabel } from "@/lib/listings/format";
import type { DistrictOption, Listing, SearchIntent } from "@/lib/listings/types";

const INTENT_TABS: { id: SearchIntent | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "buy", label: "Buy" },
  { id: "rent", label: "Rent" },
  { id: "land", label: "Land" },
];

/* ----------------------------------------------------------------------------
   The search results, as an editorial index rather than a card grid.

   Results are queried on the server (app/(site)/properties/page.tsx) from the
   URL. Changing a filter updates the URL; the server re-runs the Supabase query
   and sends back only the matching listings. The page remounts this component
   per query string, so local state always starts from the URL.
---------------------------------------------------------------------------- */
export function PropertiesIndex({
  listings,
  unavailable,
  districts,
  initialFilters,
  initialIntent,
}: {
  listings: Listing[];
  unavailable: boolean;
  districts: DistrictOption[];
  initialFilters: FilterState;
  initialIntent: SearchIntent | "all";
}) {
  const [filters, setFilters] = useState(initialFilters);
  const [intent, setIntent] = useState<SearchIntent | "all">(initialIntent);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const sync = (next: FilterState, nextIntent: SearchIntent | "all") => {
    startTransition(() => {
      router.replace(`/properties${filtersToQuery(next, nextIntent)}`, { scroll: false });
    });
  };

  return (
    <>
      <div className="shell border-b border-ivory/10 pb-10">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
          {INTENT_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => { setIntent(t.id); sync(filters, t.id); }}
              aria-pressed={intent === t.id}
              className={`label transition-colors duration-500 ${
                intent === t.id ? "text-champagne" : "text-ivory/45 hover:text-ivory"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <PropertyFilters
          className="mt-8"
          value={filters}
          districts={districts}
          onChange={(next) => { setFilters(next); sync(next, intent); }}
        />
      </div>

      <div
        className={`shell pb-[var(--spacing-section)] pt-10 transition-opacity duration-500 ${pending ? "opacity-50" : ""}`}
        aria-busy={pending}
      >
        {unavailable ? (
          <div className="border-t border-ivory/12 py-20 text-center">
            <p className="display-sm text-ivory/70">Listings are temporarily unavailable.</p>
            <p className="mt-4 text-sm text-ivory/45">Please try again in a moment.</p>
          </div>
        ) : (
          <>
            <p className="label text-ivory/40">
              <span className="text-champagne">{listings.length}</span>{" "}
              {listings.length === 1 ? "property" : "properties"}
            </p>

            {listings.length === 0 ? (
              <div className="border-t border-ivory/12 py-20 text-center">
                <p className="display-sm text-ivory/70">Nothing matches those filters.</p>
                <p className="mt-4 text-sm text-ivory/45">Widen the price band or choose another neighbourhood.</p>
              </div>
            ) : (
              <ul className="mt-8">
                {listings.map((listing, i) => (
                  <li key={listing.slug}>
                    <ResultRow listing={listing} position={i} flip={i % 2 === 1} eager={i < 2} />
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </>
  );
}

function ResultRow({
  listing, position, flip, eager,
}: { listing: Listing; position: number; flip: boolean; eager: boolean }) {
  const meta = metaLine(listing);
  return (
    <Link
      href={`/properties/${listing.slug}`}
      className="group grid items-center gap-6 border-t border-ivory/12 py-8 md:grid-cols-[1fr_1.1fr] md:gap-14 md:py-12"
    >
      <div className={`relative aspect-[16/10] overflow-hidden bg-black ${flip ? "md:order-2" : ""}`}>
        {listing.media.cover && (
          <Image
            src={listing.media.cover.url}
            alt={listing.media.cover.alt}
            fill
            sizes="(max-width: 768px) 100vw, 46vw"
            loading={eager ? "eager" : "lazy"}
            className="img-zoom object-cover"
          />
        )}
      </div>

      <div className={flip ? "md:order-1" : ""}>
        <p className="label text-champagne">{positionLabel(position)} · {listing.typeLabel}</p>
        <h2 className="display-sm mt-3 text-ivory">
          <span className="link-underline">{listing.name}</span>
        </h2>
        <p className="label mt-3 text-ivory/50">{locationLine(listing)}</p>
        {listing.description[0] && (
          <p className="measure mt-5 line-clamp-3 text-sm font-light leading-relaxed text-ivory/60">{listing.description[0]}</p>
        )}
        {meta.length > 0 && <p className="label mt-6 text-ivory/70">{meta.join(" · ")}</p>}
        <div className="mt-5 flex flex-wrap items-center justify-between gap-4">
          <p className="font-display text-[1.6rem] leading-none text-champagne">{formatPrice(listing)}</p>
          <span className="label-lg inline-flex items-center gap-3 text-ivory">
            <span className="link-underline">View property</span>
            <span className="arrow-slide" aria-hidden>→</span>
          </span>
        </div>
      </div>
    </Link>
  );
}

export function IndexFooterNote() {
  return (
    <div className="shell pb-16">
      <div className="flex flex-wrap items-center justify-between gap-6 border-t border-ivory/12 pt-8">
        <p className="label text-ivory/40">Can&rsquo;t see it here? We place properties before they are listed.</p>
        <ArrowLink href="/#contact">Tell us what you are looking for</ArrowLink>
      </div>
    </div>
  );
}
