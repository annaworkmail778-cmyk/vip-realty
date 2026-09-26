import Image from "next/image";
import { ButtonLink } from "@/components/ui/ArrowLink";
import { media } from "@/lib/media";
import { getDictionary } from "@/lib/i18n/get-dictionary";
import { fill } from "@/lib/i18n/fill";

/* ----------------------------------------------------------------------------
   09 — Closing. One image, one sentence, two ways forward.
---------------------------------------------------------------------------- */

export async function FinalCTA({ brandName }: { brandName: string }) {
  const { dict } = await getDictionary();

  return (
    <section
      id="contact"
      data-nav-tone="dark"
      className="relative flex min-h-[86svh] items-center justify-center overflow-hidden bg-black text-center text-ivory"
    >
      <div className="media-fill">
        <Image
          src={media.hero.evening}
          alt=""
          fill
          sizes="100vw"
          loading="lazy"
          className="object-cover opacity-80"
        />
      </div>
      <div className="pointer-events-none absolute inset-0 bg-black/45" aria-hidden />

      <div className="shell relative py-[var(--spacing-section)]">
        <p data-reveal="fade" className="label text-champagne">{dict.cta.eyebrow}</p>

        <h2 data-reveal="up" className="display-lg mx-auto mt-8 max-w-[16ch]">
          {dict.cta.title}
        </h2>

        <div data-reveal="up" className="mt-12 flex flex-wrap items-center justify-center gap-3 sm:gap-4">
          <ButtonLink href="/properties">{dict.hero.explore}</ButtonLink>
          <ButtonLink href="/#footer-contact" variant="outline">
            {fill(dict.contact.contactBrand, { brand: brandName })}
          </ButtonLink>
        </div>
      </div>
    </section>
  );
}
