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

const nextConfig: NextConfig = {
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
