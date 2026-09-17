import "server-only";
import { cache } from "react";
import { connection } from "next/server";
import { supabasePublic } from "@/lib/supabase/public";
import { LISTING_COLUMNS, mapListing, typesForCategory } from "./mappers";
import { CATEGORY_TYPES, PRICE_BANDS, placeId } from "./taxonomy";
import type { ListingSearch } from "./filters";
import type { Category, CategoryCounts, DistrictOption, Listing, ListingFacets } from "./types";

/* ----------------------------------------------------------------------------
   Public listing queries. The only place the website talks to Supabase for
   listings.

   * Reads the `published_property_listings` view with the publishable key, so
     the database — not React — enforces "published only" (RLS + view filter).
   * Filtering, ordering and limits run in Postgres; the browser only receives
     the rendered result.
   * `connection()` marks every caller as request-time rendering and the client
     fetches with `cache: "no-store"`: a listing published or changed in
     Supabase is visible on the next request, with no rebuild or redeploy.
   * Failures return `{ ok: false }` and are logged without internals; pages
     decide how to degrade. Nothing here invents fallback listings.
---------------------------------------------------------------------------- */

export type QueryResult<T> = { ok: true; data: T } | { ok: false; reason: "unconfigured" | "unavailable" };

const VIEW = "published_property_listings";

/** Upper bound for one results page until the index gains pagination. */
export const INDEX_LIMIT = 200;

const unconfigured = { ok: false, reason: "unconfigured" } as const;
const unavailable = { ok: false, reason: "unavailable" } as const;

let warnedUnconfigured = false;

async function db() {
  await connection();
  const client = supabasePublic();
  if (!client && !warnedUnconfigured) {
    warnedUnconfigured = true;
    console.warn("[listings] Supabase public read is not configured (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY).");
  }
  return client;
}

function logFailure(operation: string, error: { code?: string; message?: string } | null) {
  console.error(`[listings] ${operation} failed`, { code: error?.code, message: error?.message });
}

function mapRows(operation: string, rows: unknown[] | null): Listing[] {
  return (rows ?? []).flatMap((row) => {
    const listing = mapListing(row);
    if (!listing) {
      const id = typeof row === "object" && row !== null && "id" in row ? String((row as { id: unknown }).id) : "unknown";
      console.error(`[listings] ${operation}: skipped malformed listing row`, { id });
      return [];
    }
    return [listing];
  });
}

/* ------------------------------------------------------------------ facets */

interface FacetIndex extends ListingFacets {
  /** Published district/city spellings per URL id, for exact matching. */
  districtLabels: Record<string, string[]>;
  cityLabels: Record<string, string[]>;
}

function buildOptions(values: (string | null)[]) {
  const labels: Record<string, string[]> = {};
  for (const raw of values) {
    const label = raw?.trim();
    if (!label) continue;
    const id = placeId(label);
    if (!id) continue;
    labels[id] ??= [];
    if (!labels[id].includes(label)) labels[id].push(label);
  }
  const options: DistrictOption[] = Object.entries(labels)
    .map(([id, spellings]) => ({ id, label: spellings[0] }))
    .sort((a, b) => a.label.localeCompare(b.label));
  return { labels, options };
}

/** Districts and cities that currently have published listings. Deduplicated per request. */
export const getListingFacets = cache(async (): Promise<QueryResult<FacetIndex>> => {
  const client = await db();
  if (!client) return unconfigured;

  const { data, error } = await client.from(VIEW).select("city, district").limit(1000);
  if (error) {
    logFailure("facets", error);
    return unavailable;
  }

  const rows = (data ?? []) as { city: string | null; district: string | null }[];
  const districts = buildOptions(rows.map((r) => r.district));
  const cities = buildOptions(rows.map((r) => r.city));
  return {
    ok: true,
    data: {
      districts: districts.options,
      cities: cities.options,
      districtLabels: districts.labels,
      cityLabels: cities.labels,
    },
  };
});

/** Public facet options only (safe to pass to client components). */
export async function getFacetOptions(): Promise<ListingFacets> {
  const facets = await getListingFacets();
  return facets.ok
    ? { districts: facets.data.districts, cities: facets.data.cities }
    : { districts: [], cities: [] };
}

/* ------------------------------------------------------------------ search */

export async function searchListings(search: ListingSearch): Promise<QueryResult<Listing[]>> {
  const client = await db();
  if (!client) return unconfigured;

  let query = client.from(VIEW).select(LISTING_COLUMNS);

  if (search.intent === "land") {
    query = query.eq("property_type", "land");
  } else if (search.intent !== "all") {
    query = query.eq("intent", search.intent).neq("property_type", "land");
  }

  if (search.type !== "any") {
    query = query.in("property_type", typesForCategory(search.type));
  }

  if (search.district !== "any" || search.city) {
    const facets = await getListingFacets();
    if (!facets.ok) return facets;

    if (search.district !== "any") {
      const labels = facets.data.districtLabels[search.district];
      if (!labels) return { ok: true, data: [] };
      query = query.in("district", labels);
    }
    if (search.city) {
      const labels = facets.data.cityLabels[search.city];
      if (!labels) return { ok: true, data: [] };
      query = query.in("city", labels);
    }
  }

  // Price bands are US-dollar purchase prices. As before, they do not apply to
  // rentals: a banded search excludes rentals unless the search is for rent.
  if (search.price !== "any" && search.intent !== "rent") {
    const band = PRICE_BANDS.find((b) => b.id === search.price)!;
    query = query.is("price_period", null).eq("currency", "USD").gte("price", band.min);
    if (Number.isFinite(band.max)) query = query.lte("price", band.max);
  }

  if (search.bedrooms !== "any") query = query.gte("bedrooms", Number(search.bedrooms));
  if (search.areaMin !== null) query = query.gte("area_sqm", search.areaMin);
  if (search.areaMax !== null) query = query.lte("area_sqm", search.areaMax);

  const { data, error } = await query
    .order("featured", { ascending: false })
    .order("published_at", { ascending: false, nullsFirst: false })
    .order("slug", { ascending: true })
    .limit(INDEX_LIMIT);

  if (error) {
    logFailure("search", error);
    return unavailable;
  }
  return { ok: true, data: mapRows("search", data) };
}

/* ------------------------------------------------------------------ single */

/** A published listing by slug; `data: null` when no published listing has that slug. */
export const getPublishedListing = cache(async (slug: string): Promise<QueryResult<Listing | null>> => {
  const client = await db();
  if (!client) return unconfigured;

  const { data, error } = await client.from(VIEW).select(LISTING_COLUMNS).eq("slug", slug).maybeSingle();
  if (error) {
    logFailure("listing by slug", error);
    return unavailable;
  }
  if (!data) return { ok: true, data: null };

  const [listing] = mapRows("listing by slug", [data]);
  return { ok: true, data: listing ?? null };
});

/* -------------------------------------------------------------- collections */

async function listOrdered(operation: string, options: { featuredOnly?: boolean; limit: number }) {
  const client = await db();
  if (!client) return unconfigured;

  let query = client.from(VIEW).select(LISTING_COLUMNS);
  if (options.featuredOnly) query = query.eq("featured", true);

  const { data, error } = await query
    .order("published_at", { ascending: false, nullsFirst: false })
    .order("slug", { ascending: true })
    .limit(options.limit);

  if (error) {
    logFailure(operation, error);
    return unavailable;
  }
  return { ok: true, data: mapRows(operation, data) } as const;
}

/** Most recently published listings. */
export const listRecentListings = (limit: number): Promise<QueryResult<Listing[]>> =>
  listOrdered("recent listings", { limit });

/** Published listings marked featured, most recent first. */
export const listFeaturedListings = (limit: number): Promise<QueryResult<Listing[]>> =>
  listOrdered("featured listings", { featuredOnly: true, limit });

/** Other published listings with the same intent, most recent first. */
export async function listRelatedListings(listing: Listing, limit = 3): Promise<QueryResult<Listing[]>> {
  const client = await db();
  if (!client) return unconfigured;

  const { data, error } = await client
    .from(VIEW)
    .select(LISTING_COLUMNS)
    .eq("intent", listing.transactionIntent)
    .neq("id", listing.id)
    .order("published_at", { ascending: false, nullsFirst: false })
    .order("slug", { ascending: true })
    .limit(limit);

  if (error) {
    logFailure("related listings", error);
    return unavailable;
  }
  return { ok: true, data: mapRows("related listings", data) };
}

/** Number of published listings per website collection. */
export async function getCategoryCounts(): Promise<QueryResult<CategoryCounts>> {
  const client = await db();
  if (!client) return unconfigured;

  const { data, error } = await client.from(VIEW).select("property_type").limit(5000);
  if (error) {
    logFailure("category counts", error);
    return unavailable;
  }

  const counts: CategoryCounts = { apartments: 0, houses: 0, land: 0, commercial: 0 };
  for (const row of (data ?? []) as { property_type: unknown }[]) {
    const category = (Object.keys(CATEGORY_TYPES) as Category[]).find((c) =>
      (CATEGORY_TYPES[c] as readonly unknown[]).includes(row.property_type),
    );
    if (category) counts[category] += 1;
  }
  return { ok: true, data: counts };
}
