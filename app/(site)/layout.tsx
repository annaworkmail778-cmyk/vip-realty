import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { MotionRoot } from "@/components/MotionRoot";
import { getFacetOptions } from "@/lib/listings/queries";

/* The public site's chrome. The admin panel sits outside this group so it does
   not inherit the marketing navigation, footer or scroll animation runtime.
   Neighbourhood links and search options list the districts that currently
   have published listings. */
export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const facets = await getFacetOptions();

  return (
    <>
      <MotionRoot />
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-6 focus:top-6 focus:z-[200] focus:bg-ivory focus:px-4 focus:py-2 focus:text-ink label"
      >
        Skip to content
      </a>
      <Navbar districts={facets.districts} />
      <main id="main">{children}</main>
      <Footer districts={facets.districts} />
    </>
  );
}
