/* ----------------------------------------------------------------------------
   Public listing model — what the website renders.

   Produced only by lib/listings/mappers.ts from Supabase rows. It carries public
   fields only (no address, coordinates, agent, review or automation data).
   Unknown values are `null`, never 0 or an empty string.

   Client-safe: types only, no runtime code, no server imports.
---------------------------------------------------------------------------- */

/** Transaction intent as stored in the database. */
export type ListingIntent = "buy" | "rent";

/** The website's search intents: land is searched as its own intent. */
export type SearchIntent = ListingIntent | "land";

export type PropertyTypeCode =
  | "apartment"
  | "penthouse"
  | "house"
  | "villa"
  | "townhouse"
  | "commercial"
  | "office"
  | "retail"
  | "warehouse"
  | "land"
  | "garage"
  | "other";

/** Website collection a property type is browsed under. */
export type Category = "apartments" | "houses" | "land" | "commercial";

export type CurrencyCode = "USD" | "AMD" | "EUR" | "RUB";

export type PricePeriod = "month" | "day" | "year";

/** Ids of the districts drawn on the stylized Yerevan map. */
export type MapDistrictId = "kentron" | "arabkir" | "davtashen" | "ajapnyak" | "avan";

export interface ListingImage {
  url: string;
  /** Stored alt text, or "" when none was stored: the renderer then derives a
   *  localised one from the display title (`fmt.imageAlt`). */
  alt: string;
  width: number | null;
  height: number | null;
}

export interface Listing {
  id: string;
  slug: string;
  name: string;
  /** Database intent (buy / rent). */
  transactionIntent: ListingIntent;
  /** Website search intent (buy / rent / land). */
  intent: SearchIntent;
  propertyType: PropertyTypeCode;
  typeLabel: string;
  category: Category | null;
  country: string | null;
  city: string;
  /** District as stored, e.g. "Arabkir" or "Արաբկիր". Render it with `fmt.districtName`. */
  districtLabel: string | null;
  /** URL id of the district, e.g. "arabkir" (lib/listings/places.ts), whatever script it was stored in. */
  district: string | null;
  price: number;
  currency: CurrencyCode;
  period: PricePeriod | null;
  priceNegotiable: boolean | null;
  area: number | null;
  landArea: number | null;
  rooms: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  /** Display string, e.g. "5 of 9". */
  floor: string | null;
  year: number | null;
  /** Description paragraphs; empty when there is no description. */
  description: string[];
  /** Human-readable feature labels. */
  features: string[];
  featured: boolean;
  publishedAt: string | null;
  media: {
    cover: ListingImage | null;
    /** Every image in gallery order (sort_order). */
    images: ListingImage[];
  };
  /** Position on the stylized map, only when the district is one the map draws. */
  map: { district: MapDistrictId; x: number; y: number } | null;
}

export interface DistrictOption {
  id: string;
  label: string;
}

export interface ListingFacets {
  districts: DistrictOption[];
  cities: DistrictOption[];
}

export type CategoryCounts = Record<Category, number>;
