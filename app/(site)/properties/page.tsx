import type { Metadata } from "next";
import { PropertiesIndex, IndexFooterNote } from "@/components/PropertiesIndex";
import type { FilterState } from "@/components/PropertyFilters";
import { parseListingSearch } from "@/lib/listings/filters";
import { getFacetOptions, searchListings } from "@/lib/listings/queries";

export const metadata: Metadata = {
  title: "Properties",
  description: "Apartments, houses, land and commercial space in Yerevan.",
};

type Search = Record<string, string | string[] | undefined>;

/* Rendered per request: the filters in the URL become a Supabase query, and
   only the matching published listings are sent to the browser. */
export default async function PropertiesPage({ searchParams }: { searchParams: Promise<Search> }) {
  const search = parseListingSearch(await searchParams);
  const [result, facets] = await Promise.all([searchListings(search), getFacetOptions()]);

  const filters: FilterState = {
    district: search.district,
    type: search.type,
    price: search.price,
    bedrooms: search.bedrooms,
  };

  const queryKey = JSON.stringify(search);

  return (
    <div data-nav-tone="dark" className="bg-ink text-ivory">
      <header className="shell pb-12 pt-[calc(var(--nav-h)+clamp(3rem,10vh,7rem))]">
        <div className="flex items-center gap-4">
          <span className="h-px w-10 gold-rule" aria-hidden />
          <p className="label text-champagne">The Index</p>
        </div>
        <h1 className="display-lg mt-6 max-w-[14ch]">Select your next address.</h1>
      </header>

      <PropertiesIndex
        key={queryKey}
        listings={result.ok ? result.data : []}
        unavailable={!result.ok}
        districts={facets.districts}
        initialFilters={filters}
        initialIntent={search.intent}
      />
      <IndexFooterNote />
    </div>
  );
}
