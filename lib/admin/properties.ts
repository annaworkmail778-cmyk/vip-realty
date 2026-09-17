import "server-only";
import { publicImageUrl } from "@/lib/listings/mappers";
import { supabaseAdmin } from "@/lib/supabase/admin";

/* ----------------------------------------------------------------------------
   Admin listing queries (read-only in this phase).

   Uses the service-role client because admins must see every listing,
   including drafts. Callers are server components under the authenticated
   admin layout only. Legacy booking columns are never selected.
---------------------------------------------------------------------------- */

export const LISTING_STATUSES = ["draft", "published", "sold", "rented", "archived"] as const;
export type ListingStatus = (typeof LISTING_STATUSES)[number];

export const REVIEW_STATUSES = ["pending", "approved", "rejected"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export type AdminResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: "unconfigured" | "unavailable" | "not_found" };

export interface AdminPropertyRow {
  id: string;
  title: string | null;
  slug: string;
  listingStatus: ListingStatus;
  reviewStatus: ReviewStatus | null;
  intent: string | null;
  propertyType: string | null;
  city: string | null;
  district: string | null;
  price: number | null;
  currency: string | null;
  pricePeriod: string | null;
  featured: boolean;
  source: string | null;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
}

export interface AdminPropertyImage {
  id: string;
  storagePath: string;
  url: string | null;
  sortOrder: number;
  altText: string | null;
  isPrimary: boolean;
  width: number | null;
  height: number | null;
}

export interface AdminPropertyDetail extends AdminPropertyRow {
  description: string | null;
  country: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  priceNegotiable: boolean | null;
  areaSqm: number | null;
  landAreaSqm: number | null;
  rooms: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  floor: number | null;
  totalFloors: number | null;
  yearBuilt: number | null;
  features: string[];
  agencyId: string | null;
  agentId: string | null;
  createdFromSessionId: string | null;
  listingStatusChangedAt: string | null;
  metadata: Record<string, unknown>;
  images: AdminPropertyImage[];
}

const LIST_COLUMNS =
  "id, title, slug, listing_status, review_status, intent, property_type, city, district, price, currency, price_period, featured, source, created_at, updated_at, published_at";

const DETAIL_COLUMNS = `${LIST_COLUMNS}, description, country, address, latitude, longitude, price_negotiable, area_sqm, land_area_sqm, rooms, bedrooms, bathrooms, floor, total_floors, year_built, features, agency_id, agent_id, created_from_session_id, listing_status_changed_at, metadata`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Row = Record<string, unknown>;

const str = (v: unknown) => (typeof v === "string" ? v : null);
const num = (v: unknown) => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
};
const oneOf = <T extends string>(v: unknown, allowed: readonly T[]) =>
  typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : null;

function mapRow(row: Row): AdminPropertyRow {
  return {
    id: String(row.id),
    title: str(row.title),
    slug: String(row.slug),
    listingStatus: oneOf(row.listing_status, LISTING_STATUSES) ?? "draft",
    reviewStatus: oneOf(row.review_status, REVIEW_STATUSES),
    intent: str(row.intent),
    propertyType: str(row.property_type),
    city: str(row.city),
    district: str(row.district),
    price: num(row.price),
    currency: str(row.currency),
    pricePeriod: str(row.price_period),
    featured: row.featured === true,
    source: str(row.source),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    publishedAt: str(row.published_at),
  };
}

function logFailure(operation: string, error: { code?: string; message?: string }) {
  console.error(`[admin] ${operation} failed`, { code: error.code, message: error.message });
}

export async function listAdminProperties(status: ListingStatus | null): Promise<AdminResult<AdminPropertyRow[]>> {
  const db = supabaseAdmin();
  if (!db) return { ok: false, reason: "unconfigured" };

  let query = db.from("properties").select(LIST_COLUMNS);
  if (status) query = query.eq("listing_status", status);

  const { data, error } = await query.order("updated_at", { ascending: false }).limit(500);
  if (error) {
    logFailure("list properties", error);
    return { ok: false, reason: "unavailable" };
  }
  return { ok: true, data: ((data ?? []) as Row[]).map(mapRow) };
}

export async function countAdminPropertiesByStatus(): Promise<AdminResult<Record<ListingStatus, number>>> {
  const db = supabaseAdmin();
  if (!db) return { ok: false, reason: "unconfigured" };

  const { data, error } = await db.from("properties").select("listing_status").limit(10_000);
  if (error) {
    logFailure("count properties", error);
    return { ok: false, reason: "unavailable" };
  }
  const counts = { draft: 0, published: 0, sold: 0, rented: 0, archived: 0 } satisfies Record<ListingStatus, number>;
  for (const row of (data ?? []) as Row[]) {
    const status = oneOf(row.listing_status, LISTING_STATUSES);
    if (status) counts[status] += 1;
  }
  return { ok: true, data: counts };
}

export async function getAdminProperty(id: string): Promise<AdminResult<AdminPropertyDetail>> {
  if (!UUID.test(id)) return { ok: false, reason: "not_found" };
  const db = supabaseAdmin();
  if (!db) return { ok: false, reason: "unconfigured" };

  const [property, images] = await Promise.all([
    db.from("properties").select(DETAIL_COLUMNS).eq("id", id).maybeSingle(),
    db.from("property_images")
      .select("id, storage_path, sort_order, alt_text, is_primary, width, height")
      .eq("property_id", id)
      .order("sort_order", { ascending: true }),
  ]);

  if (property.error || images.error) {
    logFailure("property detail", (property.error ?? images.error)!);
    return { ok: false, reason: "unavailable" };
  }
  if (!property.data) return { ok: false, reason: "not_found" };

  const row = property.data as Row;
  return {
    ok: true,
    data: {
      ...mapRow(row),
      description: str(row.description),
      country: str(row.country),
      address: str(row.address),
      latitude: num(row.latitude),
      longitude: num(row.longitude),
      priceNegotiable: typeof row.price_negotiable === "boolean" ? row.price_negotiable : null,
      areaSqm: num(row.area_sqm),
      landAreaSqm: num(row.land_area_sqm),
      rooms: num(row.rooms),
      bedrooms: num(row.bedrooms),
      bathrooms: num(row.bathrooms),
      floor: num(row.floor),
      totalFloors: num(row.total_floors),
      yearBuilt: num(row.year_built),
      features: Array.isArray(row.features) ? row.features.filter((f): f is string => typeof f === "string") : [],
      agencyId: str(row.agency_id),
      agentId: str(row.agent_id),
      createdFromSessionId: str(row.created_from_session_id),
      listingStatusChangedAt: str(row.listing_status_changed_at),
      metadata: typeof row.metadata === "object" && row.metadata !== null && !Array.isArray(row.metadata)
        ? (row.metadata as Record<string, unknown>)
        : {},
      images: ((images.data ?? []) as Row[]).map((img) => {
        const path = String(img.storage_path);
        return {
          id: String(img.id),
          storagePath: path,
          url: publicImageUrl(path),
          sortOrder: num(img.sort_order) ?? 0,
          altText: str(img.alt_text),
          isPrimary: img.is_primary === true,
          width: num(img.width),
          height: num(img.height),
        };
      }),
    },
  };
}
