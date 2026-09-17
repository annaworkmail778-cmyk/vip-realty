import "server-only";
import { PROPERTIES } from "@/lib/properties";
import { createSupabaseStore } from "./supabase-store";
import { DevBookingStore } from "./dev-store";
import type { BookingStore } from "./store";
import type { PropertyRecord } from "./types";

/* ----------------------------------------------------------------------------
   Store resolution.

   Supabase whenever it is configured; otherwise a file-backed development
   store so the booking flow still runs locally. `storeKind()` lets the UI say
   which one is in use rather than quietly pretending bookings are persisted.
---------------------------------------------------------------------------- */

/**
 * The site's own property file stays the source of truth for content. The
 * database holds only what a booking needs to reference, which is why there is
 * no second property system to keep in step by hand.
 */
export function propertiesForStore(): PropertyRecord[] {
  return PROPERTIES.map((p) => ({
    id: p.slug,
    slug: p.slug,
    title: p.name,
    location: `${p.city} · ${p.districtLabel}`,
    address: `${p.districtLabel}, ${p.city}`,
    propertyType: p.category === "land" ? "land" : p.typeLabel.toLowerCase(),
    status: "available",
    // Land is shown by appointment: there is nothing to walk around on a slot.
    viewingMode: p.category === "land" ? "appointment_only" : "standard",
    viewingDurationMinutes: 90,
    price: p.price,
    pricePeriod: p.period ?? null,
    metadata: { index: p.index, area: p.area, bedrooms: p.bedrooms, bathrooms: p.bathrooms, intent: p.intent },
  }));
}

let devStore: DevBookingStore | null = null;

export function getBookingStore(): BookingStore {
  const supabase = createSupabaseStore();
  if (supabase) return supabase;
  devStore ??= new DevBookingStore(propertiesForStore);
  return devStore;
}

export const storeKind = () => getBookingStore().kind;
