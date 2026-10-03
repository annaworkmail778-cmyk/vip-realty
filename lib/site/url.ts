import type { Metadata } from "next";

/* ----------------------------------------------------------------------------
   The public site's own address, from NEXT_PUBLIC_SITE_URL.

   Set on the host per deployment (Netlify URL today, the agency's domain at
   launch) and compiled into the build, so changing it needs a redeploy. Nothing
   here hard-codes a domain: with the variable unset or invalid, canonical links,
   the sitemap and the robots.txt sitemap line are simply left out rather than
   pointing at a guessed host. Locales share one URL (the language is a cookie),
   so a page has exactly one canonical address.
---------------------------------------------------------------------------- */

/** "https://example.am", or null when NEXT_PUBLIC_SITE_URL is unset or not an http(s) URL. */
export function siteOrigin(): string | null {
  const raw = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
  } catch {
    return null;
  }
}

/** Absolute URL of a site path, or null without a configured origin. */
export const absoluteUrl = (path: string) => {
  const origin = siteOrigin();
  return origin ? `${origin}${path.startsWith("/") ? path : `/${path}`}` : null;
};

/** `alternates.canonical` for a page path (no query string), only when the origin is known. */
export function canonical(path: string): Pick<Metadata, "alternates"> {
  return siteOrigin() ? { alternates: { canonical: path } } : {};
}
