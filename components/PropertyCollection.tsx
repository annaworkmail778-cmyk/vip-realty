"use client";

import { useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import { SectionLabel } from "@/components/ui/SectionLabel";
import { gsap, useGsap, DESKTOP } from "@/lib/motion";
import { media } from "@/lib/media";
import { CATEGORIES } from "@/lib/listings/taxonomy";
import type { CategoryCounts } from "@/lib/listings/types";

/* ----------------------------------------------------------------------------
   05 — The VIP Collection.

   A horizontal gallery driven by vertical scroll: the section pins and the
   track translates. On touch screens it degrades to a native horizontal
   scroller with snap points, which is what a phone actually wants.

   `counts` are published listings per collection, counted by the database.
   Card imagery is brand photography, not listing photos.
---------------------------------------------------------------------------- */

export function PropertyCollection({ counts }: { counts: CategoryCounts | null }) {
  const root = useRef<HTMLElement>(null);
  const cards = CATEGORIES.map((c) => ({
    ...c,
    image: media.collection[c.id],
    count: counts ? counts[c.id] : null,
  }));

  useGsap(() => {
    // Pinned horizontal scrolling is a desktop behaviour; on touch screens the
    // track is a native snap scroller and GSAP keeps its hands off it.
    const mm = gsap.matchMedia();

    mm.add(DESKTOP, () => {
      const track = root.current?.querySelector<HTMLElement>("[data-track]");
      const viewport = root.current?.querySelector<HTMLElement>("[data-viewport]");
      if (!track || !viewport) return;

      const distance = () => Math.max(0, track.scrollWidth - viewport.clientWidth);

      gsap.to(track, {
        x: () => -distance(),
        ease: "none",
        scrollTrigger: {
          trigger: root.current,
          start: "top top",
          end: () => `+=${distance() + window.innerHeight * 0.6}`,
          pin: true,
          scrub: 0.6,
          invalidateOnRefresh: true,
        },
      });

      // Images drift against the track so the gallery has depth rather than
      // sliding as one flat plane.
      gsap.utils.toArray<HTMLElement>("[data-card] img").forEach((img) => {
        gsap.fromTo(
          img,
          { xPercent: -4 },
          {
            xPercent: 4,
            ease: "none",
            scrollTrigger: {
              trigger: root.current,
              start: "top top",
              end: () => `+=${distance()}`,
              scrub: true,
            },
          },
        );
      });
    });

    return () => mm.revert();
  }, root, []);

  return (
    <section ref={root} data-nav-tone="dark" className="relative overflow-hidden bg-espresso text-ivory">
      <div className="flex h-[100svh] flex-col pb-10 pt-[calc(var(--nav-h)+clamp(2rem,7vh,4.5rem))]">
        <div className="shell shrink-0">
          <SectionLabel index="05">Categories</SectionLabel>
          <div className="mt-6 flex flex-wrap items-end justify-between gap-6">
            <h2 data-reveal="up" className="display-md">The VIP Collection</h2>
            <p className="label hidden text-ivory/40 lg:block">Scroll to move across →</p>
          </div>
        </div>

        <div
          data-viewport
          className="mt-8 min-h-0 flex-1 overflow-x-auto overflow-y-hidden lg:overflow-hidden [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          <div
            data-track
            className="flex h-full snap-x snap-mandatory gap-5 pl-[clamp(1.25rem,5vw,5.5rem)] pr-[clamp(1.25rem,5vw,5.5rem)] lg:snap-none lg:gap-8 lg:pr-[30vw]"
          >
            {cards.map((c, i) => (
              <article
                key={c.id}
                data-card
                className="group relative h-full w-[78vw] shrink-0 snap-start overflow-hidden bg-black sm:w-[52vw] lg:w-[34vw] xl:w-[30vw]"
              >
                <Link href={`/properties?type=${c.id}`} className="block h-full">
                  <div className="absolute inset-0 overflow-hidden">
                    <Image
                      src={c.image}
                      alt={c.label}
                      fill
                      sizes="(max-width: 1024px) 78vw, 34vw"
                      loading={i < 2 ? "eager" : "lazy"}
                      className="scale-110 object-cover transition-transform duration-[1400ms] [transition-timing-function:var(--ease-editorial)] group-hover:scale-[1.16]"
                    />
                  </div>
                  <div className="pointer-events-none absolute inset-0 scrim-bottom" aria-hidden />

                  <div className="relative flex h-full flex-col justify-end p-7">
                    <p className="label text-champagne">
                      0{i + 1}{c.count !== null ? ` · ${c.count} listed` : ""}
                    </p>
                    <h3 className="display-sm mt-3">{c.label}</h3>
                    <p className="mt-3 max-w-[30ch] text-sm font-light leading-relaxed text-ivory/65">
                      {c.blurb}
                    </p>
                    <span className="label-lg mt-6 inline-flex items-center gap-3 text-ivory">
                      <span className="link-underline">Explore</span>
                      <span className="arrow-slide" aria-hidden>→</span>
                    </span>
                  </div>
                </Link>
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
