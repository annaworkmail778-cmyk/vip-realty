"use client";

import { useRef, useState } from "react";
import { SectionLabel } from "@/components/ui/SectionLabel";
import { PropertyFeature } from "@/components/PropertyFeature";
import { ArrowLink } from "@/components/ui/ArrowLink";
import { gsap, useGsap, DESKTOP } from "@/lib/motion";
import { PROPERTIES } from "@/lib/properties";

/* ----------------------------------------------------------------------------
   03 — Select your next address.

   The sequence: one property fills the viewport, the next enters as you scroll.
   The stage is sticky and a single scrubbed timeline cross-fades the layers,
   scales the incoming image and lifts its metadata into place.

   Below `lg` the same properties render as stacked editorial blocks — a
   scrubbed sequence on a phone fights the user's scroll rather than carrying it.
---------------------------------------------------------------------------- */

const items = PROPERTIES;

export function NextAddress() {
  const root = useRef<HTMLElement>(null);
  const [current, setCurrent] = useState(0);

  useGsap(() => {
    // The scrubbed sequence is a desktop layout. Below `lg` the same properties
    // render as stacked blocks and none of this runs.
    const mm = gsap.matchMedia();

    mm.add(DESKTOP, () => {
      const layers = gsap.utils.toArray<HTMLElement>("[data-layer]");
      if (layers.length < 2) return;

      gsap.set(layers, { autoAlpha: 0 });
      gsap.set(layers[0], { autoAlpha: 1 });

      const tl = gsap.timeline({
        defaults: { ease: "none" },
        scrollTrigger: {
          trigger: "[data-stage-track]",
          start: "top top",
          end: "bottom bottom",
          scrub: 0.65,
          onUpdate: (self) => {
            const i = Math.min(layers.length - 1, Math.round(self.progress * (layers.length - 1)));
            setCurrent(i);
          },
        },
      });

      // One segment per hand-off: the outgoing panel dims and drifts back, the
      // incoming image settles out of a slight over-scale, its metadata lifts in.
      layers.forEach((layer, i) => {
        if (i === 0) return;
        const prev = layers[i - 1];
        const media = layer.querySelector("[data-feature='media']");
        const text = layer.querySelectorAll("[data-feature='text']");

        tl.to(prev, { autoAlpha: 0, duration: 0.55 }, i - 1 + 0.3)
          .to(prev.querySelector("[data-feature='media']"), { scale: 1.06, duration: 0.85 }, i - 1 + 0.3)
          .fromTo(layer, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.55 }, i - 1 + 0.38)
          .fromTo(media, { scale: 1.12 }, { scale: 1, duration: 1 }, i - 1 + 0.3)
          .fromTo(text, { yPercent: 65, opacity: 0 }, { yPercent: 0, opacity: 1, duration: 0.6, stagger: 0.06 }, i - 1 + 0.42);
      });
    });

    return () => mm.revert();
  }, root, []);

  return (
    <section ref={root} data-nav-tone="dark" id="properties" className="relative bg-ink text-ivory">
      <div className="shell pt-[var(--spacing-section)]">
        <SectionLabel index="03">The Selection</SectionLabel>
        <div className="mt-7 flex flex-wrap items-end justify-between gap-8">
          <h2 data-reveal="up" className="display-lg max-w-[16ch]">
            Select your<br />next address.
          </h2>
          <p data-reveal="up" className="measure pb-2 text-sm font-light leading-relaxed text-ivory/55">
            Six properties, currently. Each one visited, measured and photographed before it
            reaches this page.
          </p>
        </div>
      </div>

      {/* ---------- desktop: scrubbed sequence ---------- */}
      <div data-stage-track className="relative mt-16 hidden lg:block" style={{ height: `${items.length * 100}vh` }}>
        <div className="sticky top-0 h-screen w-full overflow-hidden">
          {items.map((property, i) => (
            <div key={property.slug} data-layer className="absolute inset-0">
              <PropertyFeature property={property} variant="stage" priority={i === 0} />
            </div>
          ))}

          {/* index rail */}
          <div className="pointer-events-none absolute bottom-0 right-[clamp(1.25rem,5vw,5.5rem)] top-0 z-20 flex flex-col items-end justify-center gap-3">
            {items.map((property, i) => (
              <div key={property.slug} className="flex items-center gap-3">
                <span
                  className={`label transition-all duration-500 ${
                    current === i ? "text-champagne opacity-100" : "text-ivory opacity-30"
                  }`}
                >
                  {property.index}
                </span>
                <span
                  className={`block h-px origin-right transition-all duration-700 ${
                    current === i ? "w-10 bg-gold" : "w-4 bg-ivory/30"
                  }`}
                />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ---------- small screens: stacked editorial blocks ---------- */}
      <div className="shell mt-14 space-y-20 lg:hidden">
        {items.map((property, i) => (
          <div key={property.slug} data-reveal="up">
            <PropertyFeature property={property} />
          </div>
        ))}
      </div>

      <div className="shell mt-16 flex justify-between border-t border-ivory/12 pt-8 lg:mt-24">
        <p className="label text-ivory/40">{items.length} of {items.length} shown</p>
        <ArrowLink href="/properties">See all properties</ArrowLink>
      </div>
    </section>
  );
}
