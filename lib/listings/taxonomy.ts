import type { Category, MapDistrictId, PropertyTypeCode, SearchIntent } from "./types";

/* ----------------------------------------------------------------------------
   Website vocabulary: labels, collections and filter options.

   This is presentation configuration, not listing data. Listings themselves
   come only from Supabase (lib/listings/queries.ts). Client-safe.
---------------------------------------------------------------------------- */

export const PROPERTY_TYPE_CODES: readonly PropertyTypeCode[] = [
  "apartment", "penthouse", "house", "villa", "townhouse", "commercial",
  "office", "retail", "warehouse", "land", "garage", "other",
];

export const PROPERTY_TYPE_LABELS: Record<PropertyTypeCode, string> = {
  apartment: "Apartment",
  penthouse: "Penthouse",
  house: "House",
  villa: "Villa",
  townhouse: "Townhouse",
  commercial: "Commercial",
  office: "Office",
  retail: "Retail",
  warehouse: "Warehouse",
  land: "Land",
  garage: "Garage",
  other: "Other",
};

/** Which property types each website collection contains. Garage/other belong to none. */
export const CATEGORY_TYPES: Record<Category, readonly PropertyTypeCode[]> = {
  apartments: ["apartment", "penthouse"],
  houses: ["house", "villa", "townhouse"],
  land: ["land"],
  commercial: ["commercial", "office", "retail", "warehouse"],
};

export const categoryOf = (type: PropertyTypeCode): Category | null =>
  (Object.keys(CATEGORY_TYPES) as Category[]).find((c) => CATEGORY_TYPES[c].includes(type)) ?? null;

export const CATEGORIES: { id: Category; label: string; blurb: string }[] = [
  { id: "apartments", label: "Apartments", blurb: "City floors with light on two sides, from pre-war stone to new towers." },
  { id: "houses",     label: "Houses",     blurb: "Private homes, terraces and gardens within reach of the centre." },
  { id: "land",       label: "Land",       blurb: "Plots with permissions, orientation and a view worth building toward." },
  { id: "commercial", label: "Commercial", blurb: "Ground floors, studios and offices on streets people actually walk." },
];

export const SEARCH_INTENTS: readonly SearchIntent[] = ["buy", "rent", "land"];

export const PROPERTY_TYPES = [
  { id: "any", label: "Any type" },
  { id: "apartments", label: "Apartment" },
  { id: "houses", label: "House" },
  { id: "land", label: "Land" },
  { id: "commercial", label: "Commercial" },
] as const;

/** Purchase-price bands. They are quoted in US dollars and only apply to sale prices. */
export const PRICE_BANDS = [
  { id: "any", label: "Any price", min: 0, max: Infinity },
  { id: "0-150", label: "Up to $150,000", min: 0, max: 150_000 },
  { id: "150-300", label: "$150,000 – $300,000", min: 150_000, max: 300_000 },
  { id: "300-600", label: "$300,000 – $600,000", min: 300_000, max: 600_000 },
  { id: "600+", label: "$600,000 +", min: 600_000, max: Infinity },
] as const;

export const BEDROOM_OPTIONS = [
  { id: "any", label: "Any" },
  { id: "1", label: "1 +" },
  { id: "2", label: "2 +" },
  { id: "3", label: "3 +" },
  { id: "4", label: "4 +" },
] as const;

export type TypeFilter = (typeof PROPERTY_TYPES)[number]["id"];
export type PriceFilter = (typeof PRICE_BANDS)[number]["id"];
export type BedroomFilter = (typeof BEDROOM_OPTIONS)[number]["id"];

/**
 * Districts drawn on the stylized map (components/YerevanMap.tsx). Positions
 * are abstract map units, not coordinates; a listing is pinned at its
 * district's position, never at its address.
 */
export const MAP_DISTRICTS: { id: MapDistrictId; label: string; blurb: string; map: { x: number; y: number } }[] = [
  { id: "kentron",   label: "Kentron",   blurb: "The centre. Opera, Northern Avenue, the cafés that never close.", map: { x: 52, y: 58 } },
  { id: "arabkir",   label: "Arabkir",   blurb: "Established, green, quietly residential. Long streets and old trees.", map: { x: 46, y: 34 } },
  { id: "davtashen", label: "Davtashen", blurb: "Open skies and new build. Families, space, the ring road close by.", map: { x: 24, y: 22 } },
  { id: "ajapnyak",  label: "Ajapnyak",  blurb: "West of the gorge. Wide views back toward the city and Ararat.", map: { x: 20, y: 52 } },
  { id: "avan",      label: "Avan",      blurb: "Elevated and calm, on the north-eastern edge. Air and distance.", map: { x: 78, y: 26 } },
];

export const isMapDistrict = (id: string | null): id is MapDistrictId =>
  id !== null && MAP_DISTRICTS.some((d) => d.id === id);

/** URL id for a place name: "Nor Nork" → "nor-nork". Empty when nothing usable remains. */
export const placeId = (label: string) =>
  label
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** "air_conditioning" → "Air conditioning". */
export const featureLabel = (code: string) => {
  const words = code.replace(/_/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "";
};
