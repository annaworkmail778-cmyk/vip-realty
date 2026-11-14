import "server-only";
import { cache } from "react";
import { supabasePublic } from "@/lib/supabase/public";
import { getLocale } from "@/lib/i18n/get-dictionary";
import { EMPTY_PROFILE, WORKING_BRAND_NAME, type SiteProfile } from "@/lib/site/profile";

/* Reads the site agency's public profile through the anonymous view. One read per request.

   `select("*")` rather than a column list: the optional columns added in migration
   20261114120000 (second phone, Russian/English address and hours) are simply
   absent on a database where that migration has not been applied yet, and the
   profile then falls back to the base values instead of failing. */

const str = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

export const getSiteProfile = cache(async (): Promise<SiteProfile> => {
  const client = supabasePublic();
  if (!client) return EMPTY_PROFILE;

  const [{ data, error }, { locale }] = await Promise.all([
    client.from("public_site_profile").select("*").maybeSingle(),
    getLocale(),
  ]);

  if (error) {
    console.error("[site] profile read failed", { code: error.code });
    return EMPTY_PROFILE;
  }
  if (!data) return EMPTY_PROFILE;

  const row = data as Record<string, unknown>;
  /* Armenian is the base value; Russian and English override it when set. */
  const localized = (base: string) =>
    (locale !== "hy" ? str(row[`${base}_${locale}`]) : null) ?? str(row[base]);

  const brand = str(row.display_name);
  return {
    configured: brand !== null,
    brandName: brand ?? WORKING_BRAND_NAME,
    brandIsPlaceholder: brand === null,
    legalName: str(row.legal_name) ?? brand ?? WORKING_BRAND_NAME,
    phone: str(row.public_phone),
    phoneSecondary: str(row.public_phone_secondary),
    whatsapp: str(row.public_whatsapp)?.replace(/\D/g, "") ?? null,
    email: str(row.public_email),
    officeAddress: localized("office_address"),
    officeHours: localized("office_hours"),
  };
});
