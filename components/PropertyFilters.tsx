"use client";

import { Select, type SelectOption } from "@/components/ui/Select";
import { useDict } from "@/components/site/LocaleProvider";
import {
  BEDROOM_OPTIONS,
  PRICE_BANDS,
  PROPERTY_TYPES,
  type BedroomFilter,
  type PriceFilter,
  type TypeFilter,
} from "@/lib/listings/taxonomy";
import type { DistrictOption } from "@/lib/listings/types";

export interface FilterState {
  /** "any" or a district URL id from the published listings. */
  district: string;
  type: TypeFilter;
  price: PriceFilter;
  bedrooms: BedroomFilter;
}

export const EMPTY_FILTERS: FilterState = {
  district: "any",
  type: "any",
  price: "any",
  bedrooms: "any",
};

/* ----------------------------------------------------------------------------
   The four filters, reused by: the editorial search section, the navigation
   search overlay, and the properties index. Presentation switches on `tone`;
   the data and the state shape never change. District options come from the
   districts that currently have published listings in Supabase.

   The option ids are the frozen taxonomy ids that travel in the query string.
   Only the labels are translated, and district labels are rendered exactly as
   the database stores them — never translated, because `placeId()` derives the
   district's URL id from that same stored text.
---------------------------------------------------------------------------- */

export function PropertyFilters({
  value,
  onChange,
  districts,
  tone = "dark",
  className = "",
}: {
  value: FilterState;
  onChange: (next: FilterState) => void;
  districts: DistrictOption[];
  tone?: "dark" | "light";
  className?: string;
}) {
  const dict = useDict();

  // Keep a selected district visible even when it no longer has listings.
  const districtOptions =
    value.district !== "any" && !districts.some((d) => d.id === value.district)
      ? [...districts, { id: value.district, label: value.district }]
      : districts;

  const set = <K extends keyof FilterState>(key: K, v: FilterState[K]) =>
    onChange({ ...value, [key]: v });

  /* A stable identity per field per surface. The properties index remounts this
     whole subtree when a filter changes, so the Select needs a name that
     survives that in order to restore keyboard focus to the right trigger; the
     two surfaces (navigation overlay and index) must not collide. */
  const field = (key: keyof FilterState) => `${tone}:${key}`;

  const localised = (
    source: readonly { id: string }[],
    labels: Record<string, string>,
  ): SelectOption[] => source.map((o) => ({ id: o.id, label: labels[o.id] ?? o.id }));

  return (
    <div className={`grid gap-px sm:grid-cols-2 lg:grid-cols-4 ${className}`}>
      <Select
        tone={tone}
        name={field("district")}
        label={dict.filters.location}
        value={value.district}
        onChange={(v) => set("district", v)}
        options={[
          { id: "any", label: dict.filters.allDistricts },
          // District names come from the database and are shown as stored.
          ...districtOptions.map((d) => ({ id: d.id, label: d.label })),
        ]}
      />
      <Select
        tone={tone}
        name={field("type")}
        label={dict.filters.propertyType}
        value={value.type}
        onChange={(v) => set("type", v as FilterState["type"])}
        options={localised(PROPERTY_TYPES, dict.taxonomy.types)}
      />
      <Select
        tone={tone}
        name={field("price")}
        label={dict.filters.price}
        value={value.price}
        onChange={(v) => set("price", v as FilterState["price"])}
        options={localised(PRICE_BANDS, dict.taxonomy.price)}
      />
      <Select
        tone={tone}
        name={field("bedrooms")}
        label={dict.filters.bedrooms}
        value={value.bedrooms}
        onChange={(v) => set("bedrooms", v as FilterState["bedrooms"])}
        options={localised(BEDROOM_OPTIONS, dict.taxonomy.bedrooms)}
      />
    </div>
  );
}

/** Turns filter state into the query string the properties index reads. */
export function filtersToQuery(f: FilterState, intent?: string) {
  const q = new URLSearchParams();
  if (intent && intent !== "all") q.set("intent", intent);
  for (const [k, v] of Object.entries(f)) if (v && v !== "any") q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : "";
}
