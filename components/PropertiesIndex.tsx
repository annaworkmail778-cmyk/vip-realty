"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PropertyFilters, filtersToQuery, type FilterState } from "@/components/PropertyFilters";
import { ArrowLink } from "@/components/ui/ArrowLink";
import {
  PROPERTIES,
  filterProperties,
  formatPrice,
  metaLine,
  type Intent,
  type Property,
} from "@/lib/properties";

const INTENT_TABS: { id: Intent | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "buy", label: "Buy" },
  { id: "rent", label: "Rent" },
  { id: "land", label: "Land" },
];

/* The search results, as an editorial index rather than a card grid. */
export function PropertiesIndex({
  initialFilters,
  initialIntent,
}: {
  initialFilters: FilterState;
  initialIntent: Intent | "all";
}) {
  const [filters, setFilters] = useState(initialFilters);
  const [intent, setIntent] = useState<Intent | "all">(initialIntent);
  const router = useRouter();

  const results = useMemo(
    () => filterProperties(PROPERTIES, { ...filters, intent }),
    [filters, intent],
  );

  // Keep the URL shareable without re-rendering the tree on every keystroke.
  const sync = (next: FilterState, nextIntent: Intent | "all") => {
    router.replace(`/properties${filtersToQuery(next, nextIntent)}`, { scroll: false });
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
          onChange={(next) => { setFilters(next); sync(next, intent); }}
        />
      </div>

      <div className="shell pb-[var(--spacing-section)] pt-10">
        <p className="label text-ivory/40">
          <span className="text-champagne">{results.length}</span>{" "}
          {results.length === 1 ? "property" : "properties"}
        </p>

        {results.length === 0 ? (
          <div className="border-t border-ivory/12 py-20 text-center">
            <p className="display-sm text-ivory/70">Nothing matches those filters.</p>
            <p className="mt-4 text-sm text-ivory/45">Widen the price band or choose another neighbourhood.</p>
          </div>
        ) : (
          <ul className="mt-8">
            {results.map((property, i) => (
              <li key={property.slug}>
                <ResultRow property={property} flip={i % 2 === 1} eager={i < 2} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

function ResultRow({ property, flip, eager }: { property: Property; flip: boolean; eager: boolean }) {
  return (
    <Link
      href={`/properties/${property.slug}`}
      className="group grid items-center gap-6 border-t border-ivory/12 py-8 md:grid-cols-[1fr_1.1fr] md:gap-14 md:py-12"
    >
      <div className={`relative aspect-[16/10] overflow-hidden bg-black ${flip ? "md:order-2" : ""}`}>
        <Image
          src={property.media.wide}
          alt={property.name}
          fill
          sizes="(max-width: 768px) 100vw, 46vw"
          loading={eager ? "eager" : "lazy"}
          className="img-zoom object-cover"
        />
      </div>

      <div className={flip ? "md:order-1" : ""}>
        <p className="label text-champagne">{property.index} · {property.typeLabel}</p>
        <h2 className="display-sm mt-3 text-ivory">
          <span className="link-underline">{property.name}</span>
        </h2>
        <p className="label mt-3 text-ivory/50">{property.city} · {property.districtLabel}</p>
        <p className="measure mt-5 text-sm font-light leading-relaxed text-ivory/60">{property.summary}</p>
        <p className="label mt-6 text-ivory/70">{metaLine(property).join(" · ")}</p>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-4">
          <p className="font-display text-[1.6rem] leading-none text-champagne">{formatPrice(property)}</p>
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
