"use client";

import { useRef } from "react";
import Image from "next/image";
import { SectionLabel } from "@/components/ui/SectionLabel";
import { ArrowLink } from "@/components/ui/ArrowLink";
import { gsap, useGsap } from "@/lib/motion";
import { media } from "@/lib/media";
import { site } from "@/lib/site";
import { useSiteProfile } from "@/components/site/SiteProfileProvider";

/* ----------------------------------------------------------------------------
   06 — About the agency.
   The one ivory section on the page; the navigation inverts across it.
---------------------------------------------------------------------------- */

export function AboutSection() {
  const root = useRef<HTMLElement>(null);

  useGsap(() => {
    gsap.to("[data-about-img]", {
      yPercent: -9,
      ease: "none",
      scrollTrigger: { trigger: "[data-about-frame]", start: "top bottom", end: "bottom top", scrub: true },
    });
  }, root, []);

  const { brandName } = useSiteProfile();
  const anyPlaceholder = site.stats.some((s) => s.placeholder);

  return (
    <section
      ref={root}
      id="about"
      data-nav-tone="light"
      className="relative bg-ivory py-[var(--spacing-section)] text-espresso"
    >
      <div className="shell">
        <SectionLabel index="06" tone="ink">About {brandName}</SectionLabel>

        <div className="mt-8 grid gap-12 lg:grid-cols-[1.1fr_1fr] lg:gap-20">
          <h2 data-reveal="up" className="display-lg text-espresso">
            {site.about.headline[0]}<br />
            <span className="text-cocoa">{site.about.headline[1]}</span>
          </h2>

          <div className="max-w-[46ch] space-y-6 self-end">
            {site.about.body.map((raw) => raw.replace("{brand}", brandName)).map((para) => (
              <p key={para} data-reveal="up" className="text-[0.98rem] font-light leading-relaxed text-espresso/75">
                {para}
              </p>
            ))}
            <div data-reveal="up">
              <ArrowLink href="/#contact" tone="ink">Talk to the team</ArrowLink>
            </div>
          </div>
        </div>
      </div>

      <div data-about-frame className="relative mt-16 h-[46vh] w-full overflow-hidden sm:h-[62vh] lg:mt-24">
        <Image
          data-about-img
          src={media.about.team}
          alt={`The ${brandName} team`}
          fill
          sizes="100vw"
          loading="lazy"
          className="scale-110 object-cover"
        />
      </div>

      <div className="shell">
        <dl className="mt-12 grid gap-y-10 border-t border-espresso/12 pt-10 sm:grid-cols-3 lg:mt-16">
          {site.stats.map((stat) => (
            <div key={stat.label} data-reveal="up">
              <dt className="display-md text-espresso">
                {stat.value}
                {stat.placeholder && <span className="align-super text-[0.3em] text-gold"> *</span>}
              </dt>
              <dd className="label mt-3 text-espresso/55">{stat.label}</dd>
            </div>
          ))}
        </dl>

        {anyPlaceholder && (
          <p className="label mt-8 max-w-[52ch] text-espresso/40">
            * Placeholder figures. Replace the values in{" "}
            <code className="font-sans tracking-normal">lib/site.ts</code> with verified numbers
            before publishing.
          </p>
        )}
      </div>
    </section>
  );
}
