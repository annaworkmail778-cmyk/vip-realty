import type { Metadata } from "next";
import { PropertiesIndex, IndexFooterNote } from "@/components/PropertiesIndex";
import { EMPTY_FILTERS, type FilterState } from "@/components/PropertyFilters";
import type { Intent } from "@/lib/properties";

export const metadata: Metadata = {
  title: "Properties",
  description: "Apartments, houses, land and commercial space in Yerevan.",
};

type Search = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function PropertiesPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;

  const filters: FilterState = {
    district: (one(sp.district) as FilterState["district"]) ?? EMPTY_FILTERS.district,
    type: (one(sp.type) as FilterState["type"]) ?? EMPTY_FILTERS.type,
    price: (one(sp.price) as FilterState["price"]) ?? EMPTY_FILTERS.price,
    bedrooms: (one(sp.bedrooms) as FilterState["bedrooms"]) ?? EMPTY_FILTERS.bedrooms,
  };
  const intent = (one(sp.intent) as Intent | undefined) ?? "all";

  return (
    <div data-nav-tone="dark" className="bg-ink text-ivory">
      <header className="shell pb-12 pt-[calc(var(--nav-h)+clamp(3rem,10vh,7rem))]">
        <div className="flex items-center gap-4">
          <span className="h-px w-10 gold-rule" aria-hidden />
          <p className="label text-champagne">The Index</p>
        </div>
        <h1 className="display-lg mt-6 max-w-[14ch]">Select your next address.</h1>
      </header>

      <PropertiesIndex initialFilters={filters} initialIntent={intent} />
      <IndexFooterNote />
    </div>
  );
}
