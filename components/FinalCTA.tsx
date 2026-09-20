import Image from "next/image";
import { ButtonLink } from "@/components/ui/ArrowLink";
import { media } from "@/lib/media";

/* ----------------------------------------------------------------------------
   09 — Closing. One image, one sentence, two ways forward.
---------------------------------------------------------------------------- */

export function FinalCTA({ brandName }: { brandName: string }) {
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
        <p data-reveal="fade" className="label text-champagne">Find your place. Own your next chapter.</p>

        <h2 data-reveal="up" className="display-lg mx-auto mt-8 max-w-[16ch]">
          Your next address is closer than you think.
        </h2>

        <div data-reveal="up" className="mt-12 flex flex-wrap items-center justify-center gap-3 sm:gap-4">
          <ButtonLink href="/properties">Explore properties</ButtonLink>
          <ButtonLink href="/#footer-contact" variant="outline">Contact {brandName}</ButtonLink>
        </div>
      </div>
    </section>
  );
}
