/* ----------------------------------------------------------------------------
   The website's brand and contact details — shared types and pure helpers.

   Single source of the values: the agency marked `is_site_primary` in the
   database, edited at /admin/agency and read through `public_site_profile`
   (see profile.server.ts). No contact detail is hard-coded anywhere.

   Until an agency is configured the site shows the project's WORKING name and
   NO contact details — never an invented phone number or address. The launch
   gate (`npm run check:config -- --site`) fails while that is the case.
---------------------------------------------------------------------------- */

/** Project working name. NOT a confirmed production brand — see the launch checklist. */
export const WORKING_BRAND_NAME = "VIP Realty";

export interface SiteProfile {
  /** True when a site agency exists and has a public display name. */
  configured: boolean;
  brandName: string;
  /** True while `brandName` is the working name rather than a configured one. */
  brandIsPlaceholder: boolean;
  legalName: string;
  phone: string | null;
  /** Digits only, for wa.me links. */
  whatsapp: string | null;
  email: string | null;
  officeAddress: string | null;
  officeHours: string | null;
}

export const EMPTY_PROFILE: SiteProfile = {
  configured: false,
  brandName: WORKING_BRAND_NAME,
  brandIsPlaceholder: true,
  legalName: WORKING_BRAND_NAME,
  phone: null,
  whatsapp: null,
  email: null,
  officeAddress: null,
  officeHours: null,
};

/** wa.me link for the configured number, or null when WhatsApp is not configured. */
export const whatsappUrl = (profile: SiteProfile, message: string) =>
  profile.whatsapp ? `https://wa.me/${profile.whatsapp}?text=${encodeURIComponent(message)}` : null;

/** `tel:` href for the configured number, or null. */
export const telHref = (profile: SiteProfile) => (profile.phone ? `tel:${profile.phone.replace(/[^\d+]/g, "")}` : null);

/** "VIP Realty" -> ["VIP", "REALTY"] for the logo lockup; single words keep one line. */
export function brandLockup(brandName: string): [string, string | null] {
  const words = brandName.trim().split(/\s+/);
  return words.length < 2 ? [words[0]?.toUpperCase() ?? "", null] : [words[0].toUpperCase(), words.slice(1).join(" ").toUpperCase()];
}
