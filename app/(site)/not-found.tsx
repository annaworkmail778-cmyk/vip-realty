import { ButtonLink } from "@/components/ui/ArrowLink";
import { getDictionary } from "@/lib/i18n/get-dictionary";

export default async function NotFound() {
  const { dict } = await getDictionary();
  return (
    <div data-nav-tone="dark" className="flex min-h-[80svh] items-center justify-center bg-ink text-center text-ivory">
      <div className="shell">
        <p className="label text-champagne">404</p>
        <h1 className="display-lg mx-auto mt-6 max-w-[16ch]">{dict.common.notFound}</h1>
        <div className="mt-10 flex flex-wrap justify-center gap-3">
          <ButtonLink href="/properties">{dict.property.all}</ButtonLink>
          <ButtonLink href="/" variant="outline">{dict.common.back}</ButtonLink>
        </div>
      </div>
    </div>
  );
}
