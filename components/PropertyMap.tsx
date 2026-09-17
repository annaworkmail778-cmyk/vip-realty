"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { SectionLabel } from "@/components/ui/SectionLabel";
import { YerevanMap } from "@/components/YerevanMap";
import { ArrowLink } from "@/components/ui/ArrowLink";
import {
  DISTRICTS,
  PROPERTIES,
  formatPrice,
  metaLine,
  type District,
  type Property,
} from "@/lib/properties";

/* ----------------------------------------------------------------------------
   07 — Find your place in Yerevan.

   District filters, a stylized map (see components/YerevanMap.tsx) and a
   preview panel. Selecting a neighbourhood highlights it, narrows the pins and
   opens the first property; selecting a pin swaps the preview. Everything reads
   from lib/properties, so connecting real listings changes nothing here.
---------------------------------------------------------------------------- */

export function PropertyMap({
  properties = PROPERTIES,
  className = "",
}: {
  properties?: Property[];
  className?: string;
}) {
  const [district, setDistrict] = useState<District | null>(null);
  const [activeSlug, setActiveSlug] = useState<string | null>(null);

  const visible = useMemo(
    () => (district ? properties.filter((p) => p.district === district) : properties),
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
        <SectionLabel index="07">Neighbourhoods</SectionLabel>

        <div className="mt-7 flex flex-wrap items-end justify-between gap-8">
          <h2 data-reveal="up" className="display-lg max-w-[15ch]">
            Find your place<br />in Yerevan.
          </h2>
          <p data-reveal="up" className="measure pb-2 text-sm font-light leading-relaxed text-ivory/55">
            Five districts, five different ways to live in the same city. Select one to see
            what is available.
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
            All Yerevan
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
              {d.label}
            </button>
          ))}
        </div>

        <div className="mt-10 grid gap-10 lg:grid-cols-[1fr_22rem] lg:gap-14">
          {/* map */}
          <div data-reveal="fade" className="relative">
            <YerevanMap
              selected={district}
              pins={visible}
              activeSlug={preview?.slug ?? null}
              counts={Object.fromEntries(
                DISTRICTS.map((d) => [d.id, properties.filter((p) => p.district === d.id).length]),
              )}
              onSelectDistrict={select}
              onSelectPin={setActiveSlug}
            />

            <p className="label mt-4 text-ivory/30">
              Stylized map · placeholder geometry
            </p>
          </div>

          {/* preview panel */}
          <div data-reveal="up" className="lg:sticky lg:top-[calc(var(--nav-h)+2rem)] lg:self-start">
            <p className="label text-ivory/45">
              {district ? DISTRICTS.find((d) => d.id === district)?.label : "All Yerevan"} ·{" "}
              <span className="text-champagne">{visible.length} available</span>
            </p>
            {district && (
              <p className="mt-3 max-w-[36ch] text-sm font-light leading-relaxed text-ivory/55">
                {DISTRICTS.find((d) => d.id === district)?.blurb}
              </p>
            )}

            {preview ? (
              <article key={preview.slug} className="mt-6 border-t border-ivory/12 pt-6">
                <div className="relative aspect-[4/3] w-full overflow-hidden bg-black">
                  <Image
                    src={preview.media.wide}
                    alt={preview.name}
                    fill
                    sizes="(max-width: 1024px) 100vw, 22rem"
                    loading="lazy"
                    className="object-cover"
                  />
                </div>
                <h3 className="display-sm mt-5">{preview.name}</h3>
                <p className="label mt-3 text-ivory/50">{preview.districtLabel} · {preview.typeLabel}</p>
                <p className="label mt-2 text-champagne">{formatPrice(preview)}</p>
                <p className="label mt-4 text-ivory/45">{metaLine(preview).join(" · ")}</p>
                <div className="mt-6">
                  <ArrowLink href={`/properties/${preview.slug}`}>View property</ArrowLink>
                </div>
              </article>
            ) : (
              <p className="mt-6 border-t border-ivory/12 pt-6 text-sm text-ivory/50">
                Nothing listed here at the moment. Try another neighbourhood.
              </p>
            )}

            {visible.length > 1 && (
              <ul className="mt-8 space-y-px border-t border-ivory/12 pt-4">
                {visible.map((p) => (
                  <li key={p.slug}>
                    <button
                      type="button"
                      onClick={() => setActiveSlug(p.slug)}
                      className={`flex w-full items-baseline justify-between gap-4 py-2 text-left transition-colors duration-300 ${
                        preview?.slug === p.slug ? "text-champagne" : "text-ivory/55 hover:text-ivory"
                      }`}
                    >
                      <span className="label">{p.index} · {p.name}</span>
                      <span className="label shrink-0 opacity-60">{p.area} m²</span>
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
