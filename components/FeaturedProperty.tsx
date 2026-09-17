"use client";

import { useRef } from "react";
import Image from "next/image";
import { ArrowLink } from "@/components/ui/ArrowLink";
import { gsap, useGsap } from "@/lib/motion";
import { formatArea, formatPrice, locationLine } from "@/lib/listings/format";
import type { Listing } from "@/lib/listings/types";

/* ----------------------------------------------------------------------------
   08 — Featured property. One listing, full frame, slow parallax.

   `listing` is the most recent published listing marked featured, selected by
   the database. The homepage omits this section when there is none.
---------------------------------------------------------------------------- */

export function FeaturedProperty({ listing: property }: { listing: Listing }) {
  const root = useRef<HTMLElement>(null);
  const cover = property.media.cover;

  useGsap(() => {
    gsap.fromTo(
      "[data-featured-img]",
      { yPercent: -7, scale: 1.14 },
      {
        yPercent: 7,
        scale: 1.06,
        ease: "none",
        scrollTrigger: { trigger: root.current, start: "top bottom", end: "bottom top", scrub: true },
      },
    );
  }, root, []);

  const size = property.area ?? property.landArea;
  const facts = [
    { label: "Location", value: locationLine(property) },
    { label: "Price", value: formatPrice(property) },
    ...(size !== null ? [{ label: "Size", value: formatArea(size) }] : []),
    ...(property.bedrooms !== null ? [{ label: "Bedrooms", value: String(property.bedrooms) }] : []),
  ];

  return (
    <section
      ref={root}
      data-nav-tone="dark"
      className="relative flex h-[100svh] min-h-[36rem] items-end overflow-hidden bg-black text-ivory"
    >
      <div className="media-fill">
        {cover && (
          <Image
            data-featured-img
            src={cover.url}
            alt={`${property.name} — featured property`}
            fill
            sizes="100vw"
            loading="lazy"
            className="object-cover"
          />
        )}
      </div>
      <div className="pointer-events-none absolute inset-0 scrim-full" aria-hidden />

      <div className="shell relative w-full pb-[clamp(2.5rem,8vh,5rem)]">
        <div className="flex items-center gap-4">
          <span className="h-px w-10 gold-rule" aria-hidden />
          <p className="label text-champagne">Featured property</p>
        </div>

        <h2 data-reveal="up" className="display-lg mt-6 max-w-[13ch]">{property.name}</h2>

        <dl className="mt-10 grid gap-y-6 border-t border-ivory/15 pt-7 sm:grid-cols-2 lg:grid-cols-4">
          {facts.map((f) => (
            <div key={f.label} data-reveal="up">
              <dt className="label text-ivory/40">{f.label}</dt>
              <dd className="mt-2 font-display text-[1.5rem] leading-none text-ivory">{f.value}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-9">
          <ArrowLink href={`/properties/${property.slug}`}>View property</ArrowLink>
        </div>
      </div>
    </section>
  );
}
