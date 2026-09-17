import type { Metadata, Viewport } from "next";
import { Cormorant_Garamond, Jost } from "next/font/google";
import "./globals.css";
import { site } from "@/lib/site";
import { media } from "@/lib/media";

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

export const metadata: Metadata = {
  metadataBase: new URL("https://vip-realty.example"),
  title: {
    default: `${site.legalName} — ${site.concept}`,
    template: `%s — ${site.name}`,
  },
  description:
    "Find your place. Own your next chapter. Properties in Yerevan selected for the way you want to live.",
  openGraph: {
    title: `${site.legalName} — ${site.concept}`,
    description: "Properties in Yerevan selected for the way you want to live.",
    images: [media.hero.og],
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#14110f",
  colorScheme: "dark",
};

/* Document shell only. The public site's navigation and footer live in
   app/(site)/layout.tsx so /admin can render without them. */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${serif.variable} ${grotesk.variable}`}>
      <body>{children}</body>
    </html>
  );
}
