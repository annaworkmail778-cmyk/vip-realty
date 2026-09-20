import "server-only";
import { cache } from "react";
import { supabasePublic } from "@/lib/supabase/public";
import { EMPTY_PROFILE, WORKING_BRAND_NAME, type SiteProfile } from "@/lib/site/profile";

/* Reads the site agency's public profile through the anonymous view. One read per request. */

const str = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

export const getSiteProfile = cache(async (): Promise<SiteProfile> => {
  const client = supabasePublic();
  if (!client) return EMPTY_PROFILE;

  const { data, error } = await client
    .from("public_site_profile")
    .select("display_name, legal_name, public_phone, public_whatsapp, public_email, office_address, office_hours")
    .maybeSingle();

  if (error) {
    console.error("[site] profile read failed", { code: error.code });
    return EMPTY_PROFILE;
  }
  if (!data) return EMPTY_PROFILE;

  const brand = str(data.display_name);
  return {
    configured: brand !== null,
    brandName: brand ?? WORKING_BRAND_NAME,
    brandIsPlaceholder: brand === null,
    legalName: str(data.legal_name) ?? brand ?? WORKING_BRAND_NAME,
    phone: str(data.public_phone),
    whatsapp: str(data.public_whatsapp)?.replace(/\D/g, "") ?? null,
    email: str(data.public_email),
    officeAddress: str(data.office_address),
    officeHours: str(data.office_hours),
  };
});
