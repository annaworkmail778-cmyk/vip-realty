"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { SectionLabel } from "@/components/ui/SectionLabel";
import { YerevanMap } from "@/components/YerevanMap";
import { ArrowLink } from "@/components/ui/ArrowLink";
import { positionLabel } from "@/lib/listings/format";
import { MAP_DISTRICTS as DISTRICTS } from "@/lib/listings/taxonomy";
import type { Listing, MapDistrictId as District } from "@/lib/listings/types";
import { useDict, useFormat } from "@/components/site/LocaleProvider";
import { fill } from "@/lib/i18n/fill";

/* ----------------------------------------------------------------------------
   07 — Find your place in Yerevan.

   District filters, a stylized map (see components/YerevanMap.tsx) and a
   preview panel. Selecting a neighbourhood highlights it, narrows the pins and
   opens the first property; selecting a pin swaps the preview.

   `properties` are published listings queried on the server. A listing is
   pinned at its district's position on the stylized map (never at its
   address); listings in districts the map does not draw appear under
   "All Yerevan" without a pin.
---------------------------------------------------------------------------- */

export function PropertyMap({
  properties,
  className = "",
}: {
  properties: Listing[];
  className?: string;
}) {
  const dict = useDict();
  const fmt = useFormat();
  const [district, setDistrict] = useState<District | null>(null);
  const [activeSlug, setActiveSlug] = useState<string | null>(null);

  const visible = useMemo(
    () => (district ? properties.filter((p) => p.map?.district === district) : properties),
    [district, properties],
  );

  const preview = useMemo(
    () => visible.find((p) => p.slug === activeSlug) ?? visible[0] ?? null,
    [activeSlug, visible],
  );

  const select = (id: District) => {
    const next = district === id ? null : id;
    setDistrict(next);
    setActiveSlug(null);
  };

  return (
    <section
      id="map"
      data-nav-tone="dark"
      className={`relative bg-ink py-[var(--spacing-section)] text-ivory ${className}`}
    >
      <div className="shell">
        <SectionLabel index="07">{dict.map.label}</SectionLabel>

        <div className="mt-7 flex flex-wrap items-end justify-between gap-8">
          <h2 data-reveal="up" className="display-lg max-w-[15ch]">
            {dict.map.title[0]}<br />{dict.map.title[1]}
          </h2>
          <p data-reveal="up" className="measure pb-2 text-sm font-light leading-relaxed text-ivory/55">
            {dict.map.note}
          </p>
        </div>

        {/* filters */}
        <div data-reveal="fade" className="mt-12 flex flex-wrap items-center gap-x-8 gap-y-3 border-y border-ivory/12 py-5">
          <button
            type="button"
            onClick={() => { setDistrict(null); setActiveSlug(null); }}
            className={`label transition-colors duration-500 ${district === null ? "text-champagne" : "text-ivory/45 hover:text-ivory"}`}
            aria-pressed={district === null}
          >
            {dict.map.all}
          </button>
          {DISTRICTS.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => select(d.id)}
              aria-pressed={district === d.id}
              className={`label transition-colors duration-500 ${
                district === d.id ? "text-champagne" : "text-ivory/45 hover:text-ivory"
              }`}
            >
              {fmt.district(d.id)}
            </button>
          ))}
        </div>

        <div className="mt-10 grid gap-10 lg:grid-cols-[1fr_22rem] lg:gap-14">
          {/* map */}
          <div data-reveal="fade" className="relative">
            <YerevanMap
              selected={district}
              pins={visible.flatMap((p) => (p.map ? [{ slug: p.slug, map: p.map }] : []))}
              activeSlug={preview?.slug ?? null}
              counts={Object.fromEntries(
                DISTRICTS.map((d) => [d.id, properties.filter((p) => p.map?.district === d.id).length]),
              )}
              onSelectDistrict={select}
              onSelectPin={setActiveSlug}
            />

            <p className="label mt-4 text-ivory/30">{dict.map.placeholderNote}</p>
          </div>

          {/* preview panel */}
          <div data-reveal="up" className="lg:sticky lg:top-[calc(var(--nav-h)+2rem)] lg:self-start">
            <p className="label text-ivory/45">
              {district ? fmt.district(district) : dict.map.all} ·{" "}
              <span className="text-champagne">{fill(dict.map.available, { count: visible.length })}</span>
            </p>
            {district && (
              <p className="mt-3 max-w-[36ch] text-sm font-light leading-relaxed text-ivory/55">
                {fmt.districtBlurb(district)}
              </p>
            )}

            {preview ? (
              <article key={preview.slug} className="mt-6 border-t border-ivory/12 pt-6">
                <div className="relative aspect-[4/3] w-full overflow-hidden bg-black">
                  {preview.media.cover && (
                    <Image
                      src={preview.media.cover.url}
                      alt={preview.media.cover.alt}
                      fill
                      sizes="(max-width: 1024px) 100vw, 22rem"
                      loading="lazy"
                      className="object-cover"
                    />
                  )}
                </div>
                <h3 className="display-sm mt-5">{preview.name}</h3>
                <p className="label mt-3 text-ivory/50">
                  {preview.districtLabel ?? preview.city} · {fmt.type(preview)}
                </p>
                <p className="label mt-2 text-champagne">{fmt.price(preview)}</p>
                {fmt.meta(preview).length > 0 && (
                  <p className="label mt-4 text-ivory/45">{fmt.meta(preview).join(" · ")}</p>
                )}
                <div className="mt-6">
                  <ArrowLink href={`/properties/${preview.slug}`}>{dict.property.view}</ArrowLink>
                </div>
              </article>
            ) : (
              <p className="mt-6 border-t border-ivory/12 pt-6 text-sm text-ivory/50">
                {dict.map.empty}
              </p>
            )}

            {visible.length > 1 && (
              <ul className="mt-8 space-y-px border-t border-ivory/12 pt-4">
                {visible.map((p, i) => (
                  <li key={p.slug}>
                    <button
                      type="button"
                      onClick={() => setActiveSlug(p.slug)}
                      className={`flex w-full items-baseline justify-between gap-4 py-2 text-left transition-colors duration-300 ${
                        preview?.slug === p.slug ? "text-champagne" : "text-ivory/55 hover:text-ivory"
                      }`}
                    >
                      <span className="label">{positionLabel(i)} · {p.name}</span>
                      {(p.area ?? p.landArea) !== null && (
                        <span className="label shrink-0 opacity-60">{fmt.area((p.area ?? p.landArea)!)}</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
