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
  /** A second public number, shown next to the first when set. */
  phoneSecondary: string | null;
  /** Digits only, for wa.me links. The same number is offered on Viber. */
  whatsapp: string | null;
  email: string | null;
  /** Address and hours in the visitor's language (falls back to the Armenian value). */
  officeAddress: string | null;
  officeHours: string | null;
}

export const EMPTY_PROFILE: SiteProfile = {
  configured: false,
  brandName: WORKING_BRAND_NAME,
  brandIsPlaceholder: true,
  legalName: WORKING_BRAND_NAME,
  phone: null,
  phoneSecondary: null,
  whatsapp: null,
  email: null,
  officeAddress: null,
  officeHours: null,
};

/** wa.me link for the configured number, or null when WhatsApp is not configured. */
export const whatsappUrl = (profile: SiteProfile, message: string) =>
  profile.whatsapp ? `https://wa.me/${profile.whatsapp}?text=${encodeURIComponent(message)}` : null;

/** `tel:` href for a number, or null. */
export const telLink = (phone: string | null) => (phone ? `tel:${phone.replace(/[^\d+]/g, "")}` : null);

/** `tel:` href for the configured main number, or null. */
export const telHref = (profile: SiteProfile) => telLink(profile.phone);

/** Viber chat link for the configured WhatsApp number (the agency uses one number for both), or null. */
export const viberUrl = (profile: SiteProfile) =>
  profile.whatsapp ? `viber://chat?number=${encodeURIComponent(`+${profile.whatsapp}`)}` : null;

/** Google Maps search for the configured office address, or null. */
export const mapsUrl = (profile: SiteProfile) =>
  profile.officeAddress
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(profile.officeAddress)}`
    : null;

/** "+374 94 12 34 56" for an Armenian E.164 number; anything else is shown as stored. */
export function formatPhone(phone: string): string {
  const am = /^\+374(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(phone.replace(/\s+/g, ""));
  return am ? `+374 ${am[1]} ${am[2]} ${am[3]} ${am[4]}` : phone;
}

/** "VIP Realty" -> ["VIP", "REALTY"] for the logo lockup; single words keep one line. */
export function brandLockup(brandName: string): [string, string | null] {
  const words = brandName.trim().split(/\s+/);
  return words.length < 2 ? [words[0]?.toUpperCase() ?? "", null] : [words[0].toUpperCase(), words.slice(1).join(" ").toUpperCase()];
}
