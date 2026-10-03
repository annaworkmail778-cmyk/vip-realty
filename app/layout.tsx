import type { Metadata, Viewport } from "next";
import { Cormorant_Garamond, Jost, Noto_Sans_Armenian, Noto_Serif_Armenian } from "next/font/google";
import "./globals.css";
import { SiteProfileProvider } from "@/components/site/SiteProfileProvider";
import { LocaleProvider } from "@/components/site/LocaleProvider";
import { media } from "@/lib/media";
import { getSiteProfile } from "@/lib/site/profile.server";
import { siteOrigin } from "@/lib/site/url";
import { getDictionary } from "@/lib/i18n/get-dictionary";
import { fill } from "@/lib/i18n/fill";
import { HTML_LANG } from "@/lib/i18n/config";

/* Typography per locale.

   Latin and Cyrillic keep the brand pair — Cormorant Garamond and Jost both ship
   a `cyrillic` subset, so Russian needs no substitute family. Neither has Armenian
   glyphs, so Armenian uses the Noto Armenian pair, which also covers Latin and
   therefore renders a mixed Armenian/Latin listing title in one face rather than
   falling back mid-string.

   next/font also emits a metric-adjusted LOCAL face per family
   ("Cormorant Garamond Fallback" = size-adjusted Times New Roman, and so on).
   Those carry NO unicode-range, so they match every script: left directly
   behind their own family they swallow Cyrillic and Armenian alike and the
   cascade never reaches the other real family. globals.css therefore spells the
   stacks out by family name and places each Fallback AFTER the cross-script
   face — see the comment there. Listing content is stored in whatever language
   the broker wrote it in, so cross-script resolution has to work. */
const serif = Cormorant_Garamond({
  subsets: ["latin", "cyrillic"],
  weight: ["300", "400", "500"],
  style: ["normal", "italic"],
  variable: "--font-serif",
  display: "swap",
});

const grotesk = Jost({
  subsets: ["latin", "cyrillic"],
  weight: ["300", "400", "500"],
  variable: "--font-grotesk",
  display: "swap",
});

const serifArmenian = Noto_Serif_Armenian({
  subsets: ["armenian", "latin"],
  weight: ["300", "400", "500"],
  variable: "--font-serif-arm",
  display: "swap",
});

const sansArmenian = Noto_Sans_Armenian({
  subsets: ["armenian", "latin"],
  weight: ["300", "400", "500"],
  variable: "--font-grotesk-arm",
  display: "swap",
});

/* Title, template and Open Graph follow the configured agency (lib/site/profile.server.ts). */
export async function generateMetadata(): Promise<Metadata> {
  const [profile, { dict }] = await Promise.all([getSiteProfile(), getDictionary()]);
  const siteUrl = siteOrigin();
  const title = `${profile.legalName} — ${dict.brand.concept}`;
  /* Both inflected forms: Armenian uses the genitive here, Russian and English
     the locative, and each dictionary picks whichever its sentence needs. */
  const place = { cityIn: dict.brand.cityIn, cityOf: dict.brand.cityOf };
  return {
    ...(siteUrl ? { metadataBase: new URL(siteUrl) } : {}),
    title: {
      default: title,
      template: `%s — ${profile.brandName}`,
    },
    description: fill(dict.page.siteDescription, place),
    openGraph: {
      title,
      description: fill(dict.page.ogDescription, place),
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
  const [profile, { locale, dict }] = await Promise.all([getSiteProfile(), getDictionary()]);
  // The locale is resolved from the cookie on the server, so the first byte of
  // HTML is already in the right language and carries the right `lang`.
  //
  // All four variables are declared in every locale. The ORDER in which they are
  // used is what changes with the language (see globals.css): the active
  // locale's pair leads and the other script's pair sits directly behind it, so
  // a listing stored in a different language than the UI still renders in a
  // brand face. Declaring a variable costs nothing on its own — each family is
  // subset with unicode-range, so a file is fetched only when a glyph needs it.
  const fonts = [serif, grotesk, serifArmenian, sansArmenian].map((f) => f.variable).join(" ");

  return (
    <html lang={HTML_LANG[locale]} className={fonts}>
      <body>
        <LocaleProvider locale={locale} dict={dict}>
          <SiteProfileProvider profile={profile}>{children}</SiteProfileProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
