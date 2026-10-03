import { Logo } from "@/components/ui/Logo";
import { ButtonLink } from "@/components/ui/ArrowLink";
import { getDictionary } from "@/lib/i18n/get-dictionary";

/* ----------------------------------------------------------------------------
   Site-wide 404 for URLs no route matches (a mistyped address, an old link).

   It renders inside the root layout — so in the visitor's language, with the
   brand fonts and the configured agency's name — but outside the (site) group,
   so without the navigation and footer. A listing slug that does not resolve is
   handled by app/(site)/not-found.tsx inside the normal page chrome instead.
   Next.js marks 404 responses `noindex` itself.
---------------------------------------------------------------------------- */

export default async function NotFound() {
  const { dict } = await getDictionary();
  return (
    <div className="flex min-h-svh flex-col bg-ink text-ivory">
      <header className="shell flex items-center pt-[clamp(1.5rem,5vh,2.5rem)]">
        <Logo className="text-ivory" />
      </header>
      <main className="flex flex-1 items-center justify-center text-center">
        <div className="shell">
          <p className="label text-champagne">404</p>
          <h1 className="display-lg mx-auto mt-6 max-w-[16ch]">{dict.common.notFound}</h1>
          <div className="mt-10 flex flex-wrap justify-center gap-3">
            <ButtonLink href="/properties">{dict.property.all}</ButtonLink>
            <ButtonLink href="/" variant="outline">{dict.common.backHome}</ButtonLink>
          </div>
        </div>
      </main>
    </div>
  );
}
