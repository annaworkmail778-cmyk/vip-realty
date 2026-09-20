import type { Metadata, Viewport } from "next";
import { Cormorant_Garamond, Jost } from "next/font/google";
import "./globals.css";
import { SiteProfileProvider } from "@/components/site/SiteProfileProvider";
import { site } from "@/lib/site";
import { media } from "@/lib/media";
import { getSiteProfile } from "@/lib/site/profile.server";

const serif = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["300", "400", "500"],
  style: ["normal", "italic"],
  variable: "--font-serif",
  display: "swap",
});

const grotesk = Jost({
  subsets: ["latin"],
  weight: ["300", "400", "500"],
  variable: "--font-grotesk",
  display: "swap",
});

/* Title, template and Open Graph follow the configured agency (lib/site/profile.server.ts). */
export async function generateMetadata(): Promise<Metadata> {
  const profile = await getSiteProfile();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  const description =
    `Find your place. Own your next chapter. Properties in ${site.city} selected for the way you want to live.`;
  return {
    ...(siteUrl ? { metadataBase: new URL(siteUrl) } : {}),
    title: {
      default: `${profile.legalName} — ${site.concept}`,
      template: `%s — ${profile.brandName}`,
    },
    description,
    openGraph: {
      title: `${profile.legalName} — ${site.concept}`,
      description: `Properties in ${site.city} selected for the way you want to live.`,
      images: [media.hero.og],
      type: "website",
    },
  };
}

export const viewport: Viewport = {
  themeColor: "#14110f",
  colorScheme: "dark",
};

/* Document shell only. The public site's navigation and footer live in
   app/(site)/layout.tsx so /admin can render without them. */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const profile = await getSiteProfile();
  return (
    <html lang="en" className={`${serif.variable} ${grotesk.variable}`}>
      <body>
        <SiteProfileProvider profile={profile}>{children}</SiteProfileProvider>
      </body>
    </html>
  );
}
