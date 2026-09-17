import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Placeholder media is generated locally into /public/media.
    // Drop real photography in the same paths and nothing else changes.
    formats: ["image/avif", "image/webp"],
    deviceSizes: [420, 640, 828, 1200, 1600, 1920, 2560],
  },
  experimental: {
    optimizePackageImports: ["gsap"],
  },
};

export default nextConfig;
