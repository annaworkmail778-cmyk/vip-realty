import {
  BEDROOM_OPTIONS,
  PRICE_BANDS,
  PROPERTY_TYPES,
  SEARCH_INTENTS,
  type BedroomFilter,
  type PriceFilter,
  type TypeFilter,
} from "./taxonomy";
import type { SearchIntent } from "./types";

/* ----------------------------------------------------------------------------
   The properties index URL contract, parsed and validated.

     /properties?intent=buy&type=apartments&district=arabkir&price=150-300
                &bedrooms=2&city=yerevan&area_min=80&area_max=200

   `intent`, `type`, `district`, `price` and `bedrooms` are the existing public
   URL parameters (unchanged). `city`, `area_min` and `area_max` are accepted as
   additional server-side filters. Anything unrecognised is ignored. Client-safe.
---------------------------------------------------------------------------- */

export interface ListingSearch {
  intent: SearchIntent | "all";
  type: TypeFilter;
  district: string;
  price: PriceFilter;
  bedrooms: BedroomFilter;
  city: string | null;
  areaMin: number | null;
  areaMax: number | null;
}

type Params = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const pick = <T extends string>(value: string | undefined, allowed: readonly T[], fallback: T): T =>
  value !== undefined && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;

const area = (value: string | undefined) => {
  if (value === undefined || !/^\d{1,6}$/.test(value)) return null;
  const n = Number(value);
  return n > 0 ? n : null;
};

export function parseListingSearch(params: Params): ListingSearch {
  const intent = one(params.intent);
  const district = one(params.district)?.toLowerCase();
  const city = one(params.city)?.toLowerCase();
  return {
    intent: intent !== undefined && (SEARCH_INTENTS as readonly string[]).includes(intent) ? (intent as SearchIntent) : "all",
    type: pick(one(params.type), PROPERTY_TYPES.map((t) => t.id), "any"),
    district: district && ID.test(district) ? district : "any",
    price: pick(one(params.price), PRICE_BANDS.map((b) => b.id), "any"),
    bedrooms: pick(one(params.bedrooms), BEDROOM_OPTIONS.map((b) => b.id), "any"),
    city: city && ID.test(city) ? city : null,
    areaMin: area(one(params.area_min)),
    areaMax: area(one(params.area_max)),
  };
}
