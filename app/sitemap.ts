import type { MetadataRoute } from "next";
import { listSitemapListings } from "@/lib/listings/queries";
import { absoluteUrl, siteOrigin } from "@/lib/site/url";

/* The homepage, the index and every published listing. Built per request (the
   listing query opts into request-time rendering), so a listing published over
   WhatsApp is in the sitemap without a rebuild. Locales share one URL, so each
   page appears once. Without NEXT_PUBLIC_SITE_URL there is no address to list
   pages under, and the sitemap is empty rather than pointing at a guessed host.
   If the database cannot be read, the two fixed pages are still listed. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  if (!siteOrigin()) return [];

  const pages: MetadataRoute.Sitemap = [
    { url: absoluteUrl("/")!, changeFrequency: "daily", priority: 1 },
    { url: absoluteUrl("/properties")!, changeFrequency: "daily", priority: 0.9 },
  ];

  const listings = await listSitemapListings();
  if (!listings.ok) return pages;

  return [
    ...pages,
    ...listings.data.map((l) => ({
      url: absoluteUrl(`/properties/${encodeURIComponent(l.slug)}`)!,
      ...(l.updatedAt ? { lastModified: new Date(l.updatedAt) } : {}),
      changeFrequency: "weekly" as const,
      priority: 0.7,
    })),
  ];
}
