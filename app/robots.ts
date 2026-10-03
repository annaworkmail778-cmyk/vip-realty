import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/site/url";

/* Public pages are crawlable; the admin area and the API are not (the admin is
   also behind a login and the API answers only POSTs). The sitemap line is
   included only when NEXT_PUBLIC_SITE_URL gives the site a known address. */
export default function robots(): MetadataRoute.Robots {
  const sitemap = absoluteUrl("/sitemap.xml");
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/admin", "/api/"] },
    ...(sitemap ? { sitemap } : {}),
  };
}
