"use client";

import { useRef } from "react";
import Image from "next/image";
import { SectionLabel } from "@/components/ui/SectionLabel";
import { ArrowLink } from "@/components/ui/ArrowLink";
import { gsap, useGsap } from "@/lib/motion";
import { media } from "@/lib/media";
import { site } from "@/lib/site";
import { useSiteProfile } from "@/components/site/SiteProfileProvider";
import { useDict } from "@/components/site/LocaleProvider";
import { fill } from "@/lib/i18n/fill";

/* ----------------------------------------------------------------------------
   06 — About the agency.
   The one ivory section on the page; the navigation inverts across it.
---------------------------------------------------------------------------- */

export function AboutSection() {
  const dict = useDict();
  const root = useRef<HTMLElement>(null);

  useGsap(() => {
    gsap.fromTo("[data-about-img]", { scale: 1.12 }, {
      scale: 1,
      ease: "none",
      scrollTrigger: { trigger: "[data-about-frame]", start: "top bottom", end: "bottom top", scrub: true },
    });
  }, root, []);

  const { brandName } = useSiteProfile();
  /* Only figures the agency has confirmed are shown (`placeholder: false` in
     lib/site.ts). Unconfirmed ones are never published, with or without a
     disclaimer; with none confirmed the row is left out entirely. */
  const stats = site.stats.filter((s) => !s.placeholder);

  return (
    <section
      ref={root}
      id="about"
      data-nav-tone="light"
      className="relative bg-ivory py-[var(--spacing-section)] text-espresso"
    >
      <div className="shell">
        <SectionLabel index="06" tone="ink">{fill(dict.about.label, { brand: brandName })}</SectionLabel>

        {/* `[&>*]:min-w-0` lets the columns shrink below their content's
            min-content width. Without it a grid item keeps `min-width: auto`,
            so one long Armenian word ("ճարտարապետության") sizes the column
            wider than the container on a very narrow phone. */}
        <div className="mt-8 grid gap-12 [&>*]:min-w-0 lg:grid-cols-[1.1fr_1fr] lg:gap-20">
          <h2 data-reveal="up" className="display-lg text-espresso">
            {dict.about.headline[0]}<br />
            <span className="text-cocoa">{dict.about.headline[1]}</span>
          </h2>

          <div className="max-w-[46ch] space-y-6 self-end">
            {dict.about.body.map((raw) => fill(raw, { brand: brandName })).map((para) => (
              <p key={para} data-reveal="up" className="text-[0.98rem] font-light leading-relaxed text-espresso/75">
                {para}
              </p>
            ))}
            <div data-reveal="up">
              <ArrowLink href="/#contact" tone="ink">{dict.contact.talkToTeam}</ArrowLink>
            </div>
          </div>
        </div>
      </div>

      {/* The agency's key visual (logo, services, Ararat over Yerevan). Shown whole at every width —
          its text is part of the picture — and revealed with a slow zoom as it scrolls in. */}
      <div data-about-frame className="shell mt-16 lg:mt-24">
        <div className="relative aspect-[16/9] w-full overflow-hidden bg-black shadow-[0_40px_80px_-40px_rgba(42,29,22,.55)]">
          <div data-about-img className="absolute inset-0">
            <Image
              src={media.aboutVisual}
              alt={`${brandName} — ${dict.about.panelTagline}`}
              fill
              sizes="(max-width: 1280px) 100vw, 1280px"
              className="object-cover"
            />
          </div>
        </div>
      </div>

      {stats.length > 0 && (
        <div className="shell">
          <dl
            className={`mt-12 grid gap-y-10 border-t border-espresso/12 pt-10 lg:mt-16 ${
              stats.length === 1 ? "" : stats.length === 2 ? "sm:grid-cols-2" : "sm:grid-cols-3"
            }`}
          >
            {stats.map((stat) => (
              <div key={stat.key} data-reveal="up">
                <dt className="display-md text-espresso tabular-nums">
                  {(() => {
                    const m = /^(\d+)(.*)$/.exec(String(stat.value));
                    if (!m) return stat.value;
                    const n = Number(m[1]);
                    /* Counts up when scrolled into view (MotionRoot); years count from a nearby year. */
                    return <span data-count={n} data-count-from={n > 1900 && n < 2100 ? n - 22 : 0} data-suffix={m[2]}>{stat.value}</span>;
                  })()}
                </dt>
                <dd className="label mt-3 text-espresso/55">{dict.about[stat.key]}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </section>
  );
}
