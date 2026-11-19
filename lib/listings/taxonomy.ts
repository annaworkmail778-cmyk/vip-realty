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

/** Fallback English labels. `mapListing()` stores one of these on every listing
 *  as `typeLabel`; the website renders the TRANSLATED label instead, looked up
 *  from the same frozen code via the formatter (lib/listings/format.ts). */
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

/** Collection order on the website. Labels and blurbs are translated:
 *  dict.taxonomy.categories[id] and dict.taxonomy.categoryBlurbs[id]. */
export const CATEGORIES: { id: Category }[] = [
  { id: "apartments" },
  { id: "houses" },
  { id: "land" },
  { id: "commercial" },
];

export const SEARCH_INTENTS: readonly SearchIntent[] = ["buy", "rent", "land"];

/* Filter options. The `id` is the frozen value that travels in the query string;
   display labels come from dict.taxonomy.* and never affect the URL. */
export const PROPERTY_TYPES = [
  { id: "any" },
  { id: "apartments" },
  { id: "houses" },
  { id: "land" },
  { id: "commercial" },
] as const;

/** Purchase-price bands. They are quoted in US dollars and only apply to sale prices. */
export const PRICE_BANDS = [
  { id: "any", min: 0, max: Infinity },
  { id: "0-150", min: 0, max: 150_000 },
  { id: "150-300", min: 150_000, max: 300_000 },
  { id: "300-600", min: 300_000, max: 600_000 },
  { id: "600+", min: 600_000, max: Infinity },
] as const;

/** Minimum number of ROOMS ("3 +"). Listings — and the Armenian market — count
 *  rooms ("3 սենյականոց"), so this filters `rooms`, not `bedrooms`. */
export const ROOM_OPTIONS = [
  { id: "any" },
  { id: "1" },
  { id: "2" },
  { id: "3" },
  { id: "4" },
] as const;

export type TypeFilter = (typeof PROPERTY_TYPES)[number]["id"];
export type PriceFilter = (typeof PRICE_BANDS)[number]["id"];
export type RoomFilter = (typeof ROOM_OPTIONS)[number]["id"];

/**
 * Districts drawn on the stylized map (components/YerevanMap.tsx). Positions
 * are abstract map units, not coordinates; a listing is pinned at its
 * district's position, never at its address.
 *
 * Ids are frozen (they travel in `?district=`); labels and blurbs are
 * translated via dict.districts[id] and dict.districtBlurbs[id].
 */
/* Approximate centre of each district (WGS84). A listing is shown at its district's centre, never at its address. */
export const MAP_DISTRICTS: { id: MapDistrictId; map: { lat: number; lng: number } }[] = [
  { id: "kentron",          map: { lat: 40.1812, lng: 44.5136 } },
  { id: "arabkir",          map: { lat: 40.2068, lng: 44.5049 } },
  { id: "ajapnyak",         map: { lat: 40.2046, lng: 44.4612 } },
  { id: "davtashen",        map: { lat: 40.2286, lng: 44.4939 } },
  { id: "avan",             map: { lat: 40.2163, lng: 44.5842 } },
  { id: "kanaker-zeytun",   map: { lat: 40.2128, lng: 44.5397 } },
  { id: "nor-nork",         map: { lat: 40.1983, lng: 44.5667 } },
  { id: "nork-marash",      map: { lat: 40.1883, lng: 44.5462 } },
  { id: "malatia-sebastia", map: { lat: 40.1699, lng: 44.4519 } },
  { id: "shengavit",        map: { lat: 40.1525, lng: 44.4933 } },
  { id: "erebuni",          map: { lat: 40.1409, lng: 44.5300 } },
  { id: "nubarashen",       map: { lat: 40.1140, lng: 44.5560 } },
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
