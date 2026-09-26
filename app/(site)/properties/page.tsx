import type { Metadata } from "next";
import { PropertiesIndex, IndexFooterNote } from "@/components/PropertiesIndex";
import type { FilterState } from "@/components/PropertyFilters";
import { parseListingSearch } from "@/lib/listings/filters";
import { getFacetOptions, searchListings } from "@/lib/listings/queries";
import { getDictionary } from "@/lib/i18n/get-dictionary";

/* Locale-aware, so the tab title and the description follow the chosen language.
   The route was already rendered per request, so this changes no caching. */
export async function generateMetadata(): Promise<Metadata> {
  const { dict } = await getDictionary();
  return {
    title: dict.page.indexMetaTitle,
    description: dict.page.indexMetaDescription,
  };
}

type Search = Record<string, string | string[] | undefined>;

/* Rendered per request: the filters in the URL become a Supabase query, and
   only the matching published listings are sent to the browser. */
export default async function PropertiesPage({ searchParams }: { searchParams: Promise<Search> }) {
  const search = parseListingSearch(await searchParams);
  const [result, facets, { dict }] = await Promise.all([
    searchListings(search),
    getFacetOptions(),
    getDictionary(),
  ]);

  const filters: FilterState = {
    district: search.district,
    type: search.type,
    price: search.price,
    bedrooms: search.bedrooms,
  };

  const queryKey = JSON.stringify(search);

  return (
    <div className="bg-ink text-ivory">
      {/* A dark editorial band introduces the page, then the inventory below sits on
          ivory. The Navbar samples data-nav-tone per section, so its colour follows. */}
      <header
        data-nav-tone="dark"
        className="shell pb-[clamp(2.5rem,6vw,4rem)] pt-[calc(var(--nav-h)+clamp(2.5rem,8vh,5.5rem))]"
      >
        <div className="flex items-center gap-4">
          <span className="h-px w-10 gold-rule" aria-hidden />
          <p className="label text-champagne">{dict.page.indexLabel}</p>
        </div>
        <h1 className="display-lg mt-6 max-w-[14ch]">{dict.page.indexTitle}</h1>
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
