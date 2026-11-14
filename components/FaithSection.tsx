import Image from "next/image";
import { media } from "@/lib/media";
import { getDictionary } from "@/lib/i18n/get-dictionary";

/* ----------------------------------------------------------------------------
   The agency's faith. A quiet, dark interlude after "About": the verse the
   founders chose, their own words, and — once supplied — their photograph.

   `media.founders` is null until the agency sends the photo; the section is
   then text only (never a stand-in picture of other people). The large gold
   mark sits behind the text as a watermark.
---------------------------------------------------------------------------- */

export async function FaithSection() {
  const { dict } = await getDictionary();
  const t = dict.faith;
  const photo = media.founders;

  return (
    <section
      id="faith"
      data-nav-tone="dark"
      className="relative overflow-hidden bg-[radial-gradient(ellipse_at_top,#3b2a20_0%,#14110f_65%)] py-[var(--spacing-section)] text-ivory"
    >
      <Image
        src={media.brand.mark}
        alt=""
        width={254}
        height={315}
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 h-[120%] w-auto -translate-x-1/2 -translate-y-1/2 opacity-[0.05]"
      />

      <div className={`shell relative grid items-center gap-14 ${photo ? "lg:grid-cols-[1fr_0.8fr] lg:gap-20" : ""}`}>
        <div className={photo ? "" : "mx-auto max-w-[44rem] text-center"}>
          <div className={`flex items-center gap-4 ${photo ? "" : "justify-center"}`}>
            <span className="h-px w-10 gold-rule" aria-hidden />
            <p className="label text-champagne">{t.label}</p>
            {!photo && <span className="h-px w-10 rotate-180 gold-rule" aria-hidden />}
          </div>

          <blockquote data-reveal="up" className="mt-10">
            <p className="font-display text-[clamp(1.7rem,4.2vw,3rem)] italic leading-[1.2] text-ivory">
              <span className="text-champagne" aria-hidden>«</span>
              {t.verse}
              <span className="text-champagne" aria-hidden>»</span>
            </p>
            <footer className="label mt-6 text-champagne/80">{t.reference}</footer>
          </blockquote>

          <p data-reveal="up" className={`mt-10 text-[1rem] font-light leading-relaxed text-ivory/70 ${photo ? "max-w-[52ch]" : "mx-auto max-w-[52ch]"}`}>
            {t.statement}
          </p>

          <div data-reveal="up" className="mt-10">
            <p className="font-display text-[1.25rem] text-ivory">{t.founders}</p>
            <p className="label mt-2 text-ivory/45">{t.foundersRole}</p>
          </div>
        </div>

        {photo && (
          <div data-reveal="fade" className="relative mx-auto aspect-[4/5] w-full max-w-[26rem] overflow-hidden border border-champagne/25">
            <Image src={photo} alt={t.photoAlt} fill sizes="(max-width: 1024px) 90vw, 26rem" className="object-cover" />
          </div>
        )}
      </div>
    </section>
  );
}
