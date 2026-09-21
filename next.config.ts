import type { NextConfig } from "next";

/* Listing photographs are served from the public `property-images` bucket in
   Supabase Storage. Only that bucket path on the configured project is allowed
   through next/image. */
const supabaseImages = (() => {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!raw) return [];
  try {
    const url = new URL(raw);
    return [{
      protocol: url.protocol.replace(":", "") as "http" | "https",
      hostname: url.hostname,
      port: url.port,
      pathname: "/storage/v1/object/public/property-images/**",
    }];
  } catch {
    return [];
  }
})();

/* Baseline response headers for every route (Phase 12). Deliberately no CSP here: the site's media, fonts and
   animation need a reviewed policy of their own. Routes that set a stricter header themselves (the admin image
   proxy's sandboxing CSP, no-store caching) keep it. HSTS without includeSubDomains/preload: it only affects the
   production host itself and is ignored by browsers on plain http. */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Strict-Transport-Security", value: "max-age=31536000" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  images: {
    // Brand media (hero, videos, collection, team) is served from /public/media.
    formats: ["image/avif", "image/webp"],
    deviceSizes: [420, 640, 828, 1200, 1600, 1920, 2560],
    remotePatterns: supabaseImages,
  },
  experimental: {
    optimizePackageImports: ["gsap"],
  },
};

export default nextConfig;
