import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { MotionRoot } from "@/components/MotionRoot";
import { getFacetOptions } from "@/lib/listings/queries";
import { getDictionary } from "@/lib/i18n/get-dictionary";
import { LanguageGate } from "@/components/site/LanguageGate";

/* The public site's chrome. The admin panel sits outside this group so it does
   not inherit the marketing navigation, footer or scroll animation runtime.
   Neighbourhood links and search options list the districts that currently
   have published listings. */
export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const [facets, { chosen, dict }] = await Promise.all([getFacetOptions(), getDictionary()]);

  return (
    <>
      <MotionRoot />
      {/* Rendered by the server only when no language has been chosen yet, so it is
          part of the first HTML rather than something revealed after hydration. */}
      {!chosen && <LanguageGate dict={dict} />}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-6 focus:top-6 focus:z-[200] focus:bg-ivory focus:px-4 focus:py-2 focus:text-ink label"
      >
        {dict.nav.skipToContent}
      </a>
      <Navbar districts={facets.districts} />
      <main id="main">{children}</main>
      <Footer districts={facets.districts} />
    </>
  );
}
