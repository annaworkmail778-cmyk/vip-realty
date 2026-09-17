"use client";

import { useId } from "react";
import {
  BEDROOM_OPTIONS,
  DISTRICTS,
  PRICE_BANDS,
  PROPERTY_TYPES,
  type Filters,
} from "@/lib/properties";

export type FilterState = Required<Pick<Filters, "district" | "type" | "price" | "bedrooms">>;

export const EMPTY_FILTERS: FilterState = {
  district: "any",
  type: "any",
  price: "any",
  bedrooms: "any",
};

/* ----------------------------------------------------------------------------
   The four filters, reused by: the editorial search section, the navigation
   search overlay, and the properties index. Presentation switches on `tone`;
   the data and the state shape never change.
---------------------------------------------------------------------------- */

export function PropertyFilters({
  value,
  onChange,
  tone = "dark",
  className = "",
}: {
  value: FilterState;
  onChange: (next: FilterState) => void;
  tone?: "dark" | "light";
  className?: string;
}) {
  const set = <K extends keyof FilterState>(key: K, v: FilterState[K]) =>
    onChange({ ...value, [key]: v });

  return (
    <div className={`grid gap-px sm:grid-cols-2 lg:grid-cols-4 ${className}`}>
      <Field
        tone={tone}
        label="Location"
        value={value.district}
        onChange={(v) => set("district", v as FilterState["district"])}
        options={[
          { id: "any", label: "All Yerevan" },
          ...DISTRICTS.map((d) => ({ id: d.id, label: d.label })),
        ]}
      />
      <Field
        tone={tone}
        label="Property Type"
        value={value.type}
        onChange={(v) => set("type", v as FilterState["type"])}
        options={PROPERTY_TYPES.map((t) => ({ id: t.id, label: t.label }))}
      />
      <Field
        tone={tone}
        label="Price"
        value={value.price}
        onChange={(v) => set("price", v as FilterState["price"])}
        options={PRICE_BANDS.map((b) => ({ id: b.id, label: b.label }))}
      />
      <Field
        tone={tone}
        label="Bedrooms"
        value={value.bedrooms}
        onChange={(v) => set("bedrooms", v as FilterState["bedrooms"])}
        options={BEDROOM_OPTIONS.map((b) => ({ id: b.id, label: b.label }))}
      />
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  options,
  tone,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { id: string; label: string }[];
  tone: "dark" | "light";
}) {
  const id = useId();
  const dark = tone === "dark";
  return (
    <div
      className={`group relative border-t px-1 pb-4 pt-5 transition-colors duration-500 sm:px-2 ${
        dark
          ? "border-ivory/15 hover:border-champagne/60"
          : "border-espresso/15 hover:border-gold/70"
      }`}
    >
      <label
        htmlFor={id}
        className={`label block ${dark ? "text-ivory/45" : "text-espresso/55"}`}
      >
        {label}
      </label>
      <div className="relative mt-2 flex items-center">
        <select
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`w-full appearance-none bg-transparent pr-7 font-display text-[1.35rem] leading-tight tracking-tight outline-none sm:text-[1.6rem] ${
            dark ? "text-ivory" : "text-espresso"
          } focus-visible:text-champagne`}
        >
          {options.map((o) => (
            <option key={o.id} value={o.id} className="bg-ink text-ivory">
              {o.label}
            </option>
          ))}
        </select>
        <span
          aria-hidden
          className={`pointer-events-none absolute right-1 text-[0.7rem] transition-transform duration-500 group-hover:translate-y-0.5 ${
            dark ? "text-champagne" : "text-gold"
          }`}
        >
          ▼
        </span>
      </div>
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
