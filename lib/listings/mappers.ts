import "server-only";
import { env } from "@/lib/env";
import {
  CATEGORY_TYPES,
  MAP_DISTRICTS,
  PROPERTY_TYPE_CODES,
  PROPERTY_TYPE_LABELS,
  categoryOf,
  featureLabel,
  placeId,
} from "./taxonomy";
import { districtIdOf } from "./places";
import type { CurrencyCode, Listing, ListingImage, ListingIntent, PricePeriod } from "./types";

/* ----------------------------------------------------------------------------
   The single boundary between Supabase rows and the website.

   Rows come from the `published_property_listings` view (public columns only).
   Everything is validated here, once: JSON values, numeric strings, enums and
   image paths. A row missing a field that a published listing must have is
   rejected (and logged by id) rather than rendered with invented values.
   Unknown optional values stay `null`.
---------------------------------------------------------------------------- */

/** Exactly the columns the website needs. Nothing internal is selected. */
export const LISTING_COLUMNS = [
  "id", "slug", "title", "description", "intent", "property_type", "country", "city", "district",
  "price", "currency", "price_period", "price_negotiable",
  "area_sqm", "land_area_sqm", "rooms", "bedrooms", "bathrooms", "floor", "total_floors", "year_built",
  "features", "featured", "published_at", "images",
].join(", ");

export const PROPERTY_IMAGES_BUCKET = "property-images";

const INTENTS: readonly ListingIntent[] = ["buy", "rent"];
const CURRENCIES: readonly CurrencyCode[] = ["USD", "AMD", "EUR", "RUB"];
const PERIODS: readonly PricePeriod[] = ["month", "day", "year"];
const STORAGE_PATH = /^properties\/[0-9a-f-]{36}\/[A-Za-z0-9_-]+\.(jpg|jpeg|png|webp|avif)$/;
const FEATURE_CODE = /^[a-z0-9_]+$/;

type Row = Record<string, unknown>;

const isRow = (v: unknown): v is Row => typeof v === "object" && v !== null && !Array.isArray(v);

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

/** PostgREST returns numerics as JSON numbers; numeric strings are accepted defensively. */
const number = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

const integer = (v: unknown): number | null => {
  const n = number(v);
  return n !== null && Number.isInteger(n) ? n : null;
};

const positive = (v: unknown): number | null => {
  const n = number(v);
  return n !== null && n > 0 ? n : null;
};

const oneOf = <T extends string>(v: unknown, allowed: readonly T[]): T | null =>
  typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : null;

/** Deterministic public URL of an object in the property-images bucket. */
export function publicImageUrl(storagePath: string): string | null {
  if (!env.supabaseUrl || !STORAGE_PATH.test(storagePath)) return null;
  const base = env.supabaseUrl.replace(/\/+$/, "");
  const path = storagePath.split("/").map(encodeURIComponent).join("/");
  return `${base}/storage/v1/object/public/${PROPERTY_IMAGES_BUCKET}/${path}`;
}

/** URL id of a stored district: the gazetteer id when the name is a known Yerevan
 *  district in any script, otherwise the slug of the stored text (or null). */
export const districtUrlId = (label: string) => districtIdOf(label) ?? (placeId(label) || null);

/* Images without stored alt text get "" here; the renderer derives a localised
   alt from the display title, which this locale-free mapper cannot know. */
function mapImages(value: unknown): { cover: ListingImage | null; images: ListingImage[] } {
  if (!Array.isArray(value)) return { cover: null, images: [] };

  const parsed = value
    .filter(isRow)
    .flatMap((item) => {
      const path = text(item.storage_path);
      const order = integer(item.sort_order);
      const url = path ? publicImageUrl(path) : null;
      if (!url || order === null) return [];
      return [{
        url,
        order,
        primary: item.is_primary === true,
        alt: text(item.alt_text),
        width: positive(item.width),
        height: positive(item.height),
      }];
    })
    .sort((a, b) => a.order - b.order);

  const images: ListingImage[] = parsed.map((img) => ({
    url: img.url,
    alt: img.alt ?? "",
    width: img.width,
    height: img.height,
  }));

  const primaryIndex = parsed.findIndex((img) => img.primary);
  const cover = images[primaryIndex >= 0 ? primaryIndex : 0] ?? null;
  return { cover, images };
}

function mapFeatures(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const codes = value.filter((v): v is string => typeof v === "string" && FEATURE_CODE.test(v));
  return [...new Set(codes)].map(featureLabel).filter(Boolean);
}

function mapDescription(value: unknown): string[] {
  const body = text(value);
  if (!body) return [];
  return body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function mapFloor(floor: number | null, total: number | null): string | null {
  if (floor !== null && total !== null) return `${floor} of ${total}`;
  if (floor !== null) return String(floor);
  return null;
}

/** Returns null when the row cannot be a valid published listing. */
export function mapListing(row: unknown): Listing | null {
  if (!isRow(row)) return null;

  const id = text(row.id);
  const slug = text(row.slug);
  const name = text(row.title);
  const transactionIntent = oneOf(row.intent, INTENTS);
  const propertyType = oneOf(row.property_type, PROPERTY_TYPE_CODES);
  const city = text(row.city);
  const price = positive(row.price);
  const currency = oneOf(row.currency, CURRENCIES);

  if (!id || !slug || !name || !transactionIntent || !propertyType || !city || price === null || !currency) {
    return null;
  }

  const districtLabel = text(row.district);
  const district = districtLabel ? districtUrlId(districtLabel) : null;
  const mapDistrict = MAP_DISTRICTS.find((d) => d.id === district) ?? null;

  return {
    id,
    slug,
    name,
    transactionIntent,
    intent: propertyType === "land" ? "land" : transactionIntent,
    propertyType,
    typeLabel: PROPERTY_TYPE_LABELS[propertyType],
    category: categoryOf(propertyType),
    country: text(row.country),
    city,
    districtLabel,
    district,
    price,
    currency,
    period: oneOf(row.price_period, PERIODS),
    priceNegotiable: typeof row.price_negotiable === "boolean" ? row.price_negotiable : null,
    area: positive(row.area_sqm),
    landArea: positive(row.land_area_sqm),
    rooms: integer(row.rooms),
    bedrooms: integer(row.bedrooms),
    bathrooms: integer(row.bathrooms),
    floor: mapFloor(integer(row.floor), integer(row.total_floors)),
    year: integer(row.year_built),
    description: mapDescription(row.description),
    features: mapFeatures(row.features),
    featured: row.featured === true,
    publishedAt: text(row.published_at),
    media: mapImages(row.images),
    map: mapDistrict ? { district: mapDistrict.id, ...mapDistrict.map } : null,
  };
}

/** Which property-type codes a website collection filter matches. */
export const typesForCategory = (category: keyof typeof CATEGORY_TYPES) => [...CATEGORY_TYPES[category]];
