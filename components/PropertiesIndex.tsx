"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PropertyCard } from "@/components/PropertyCard";
import { PropertyFilters, filtersToQuery, type FilterState } from "@/components/PropertyFilters";
import { ArrowLink } from "@/components/ui/ArrowLink";
import { useDict, useFormat } from "@/components/site/LocaleProvider";
import type { DistrictOption, Listing, SearchIntent } from "@/lib/listings/types";

const INTENT_TABS: { id: SearchIntent | "all"; key: "intentAll" | "intentBuy" | "intentRent" | "intentLand" }[] = [
  { id: "all", key: "intentAll" },
  { id: "buy", key: "intentBuy" },
  { id: "rent", key: "intentRent" },
  { id: "land", key: "intentLand" },
];

/* ----------------------------------------------------------------------------
   The search results.

   Results are queried on the server (app/(site)/properties/page.tsx) from the
   URL. Changing a filter updates the URL; the server re-runs the Supabase query
   and sends back only the matching listings. The page remounts this component
   per query string, so local state always starts from the URL. That architecture
   is unchanged — only the presentation is.

   Presentation: a responsive grid on the ivory inventory surface (1 / 2 / 3
   columns), because browsing is a scanning task. The dark editorial sections
   above and below keep the brand voice; this part exists to be read quickly.
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
  const dict = useDict();
  const fmt = useFormat();
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
    <div data-nav-tone="light" className="bg-ivory text-ink">
      <div className="shell border-b border-espresso/12 pt-[clamp(2rem,5vw,3.5rem)] pb-8">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
          {INTENT_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => { setIntent(t.id); sync(filters, t.id); }}
              aria-pressed={intent === t.id}
              className={`label border-b pb-1.5 transition-colors duration-500 ${
                intent === t.id
                  ? "border-gold text-espresso"
                  : "border-transparent text-espresso/45 hover:text-espresso"
              }`}
            >
              {dict.filters[t.key]}
            </button>
          ))}
        </div>

        <PropertyFilters
          className="mt-7"
          tone="light"
          value={filters}
          districts={districts}
          onChange={(next) => { setFilters(next); sync(next, intent); }}
        />
      </div>

      <div
        className={`shell pb-[var(--spacing-inventory)] pt-8 transition-opacity duration-500 ${
          pending ? "opacity-60" : ""
        }`}
        aria-busy={pending}
      >
        {unavailable ? (
          <EmptyState
            title={dict.results.unavailable}
            note={dict.results.unavailableNote}
          />
        ) : (
          <>
            <p className="label text-espresso/55" aria-live="polite">
              <span className="text-gold">{fmt.number(listings.length)}</span>{" "}
              {fmt.plural(listings.length, "properties")}
            </p>

            {listings.length === 0 ? (
              <EmptyState
                title={dict.results.empty}
                note={dict.results.emptyNote}
              />
            ) : (
              <ul className="mt-6 grid gap-5 sm:grid-cols-2 sm:gap-6 xl:grid-cols-3">
                {listings.map((listing, i) => (
                  <li key={listing.slug} className="flex">
                    <PropertyCard listing={listing} priority={i < 3} />
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function EmptyState({ title, note }: { title: string; note: string }) {
  return (
    <div className="border-t border-espresso/12 py-20 text-center">
      <p className="display-sm text-espresso">{title}</p>
      <p className="mt-4 text-sm text-cocoa">{note}</p>
    </div>
  );
}

export function IndexFooterNote() {
  const dict = useDict();
  return (
    <div className="bg-ivory" data-nav-tone="light">
      <div className="shell pb-16">
        <div className="flex flex-wrap items-center justify-between gap-6 border-t border-espresso/12 pt-8">
          <p className="label text-espresso/55">{dict.contact.notListed}</p>
          <ArrowLink href="/#contact" tone="ink">{dict.contact.tellUs}</ArrowLink>
        </div>
      </div>
    </div>
  );
}
