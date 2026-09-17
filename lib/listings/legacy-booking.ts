import "server-only";
import { bySlug, type Property } from "@/lib/properties";

/* ----------------------------------------------------------------------------
   LEGACY BRIDGE — removed together with the booking system (Phase 3).

   Public listing data comes from Supabase. The booking system, however, still
   runs on the hard-coded dataset in lib/properties.ts (its development store
   and its panel both use that `Property` shape). A viewing can therefore only
   be booked for a slug the booking system knows.

   This returns that legacy record when one exists, so a listing page offers
   booking exactly where booking works, and never fabricates a booking record
   for a Supabase listing.
---------------------------------------------------------------------------- */

export const legacyBookingProperty = (slug: string): Property | null => bySlug(slug) ?? null;
