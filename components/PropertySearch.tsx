"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { SectionLabel } from "@/components/ui/SectionLabel";
import { PropertyFilters, EMPTY_FILTERS, filtersToQuery, type FilterState } from "@/components/PropertyFilters";
import { media } from "@/lib/media";
import { DESKTOP, useMediaQuery, useReducedMotion } from "@/lib/motion";
import { site } from "@/lib/site";
import type { Intent } from "@/lib/properties";

/* ----------------------------------------------------------------------------
   02 — Property search.
   Intent first, filters second. The three intents are set as editorial type
   against a single frame that cross-fades, rather than as three cards. Each
   intent carries a short ambient loop; only the one on screen plays.
---------------------------------------------------------------------------- */

const INTENTS: { id: Intent; label: string; blurb: string; media: { poster: string; video: string } }[] = [
  { id: "buy",  label: "Buy",  blurb: "Apartments, houses and penthouses held for the long term.", media: media.intent.buy },
  { id: "rent", label: "Rent", blurb: "Furnished and unfurnished homes on six- and twelve-month terms.", media: media.intent.rent },
  { id: "land", label: "Land", blurb: "Plots with permissions, services and an orientation worth building on.", media: media.intent.land },
];

/**
 * An intent loop. The poster paints immediately; the clip itself is only
 * fetched once that intent is the one being shown, so arriving at the section
 * costs one short video rather than three.
 */
function IntentLoop({ poster, video, active }: {
  poster: string;
  video: string;
  active: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const reduced = useReducedMotion();
  const [load, setLoad] = useState(false);

  // Latch on first activation, during render rather than in an effect: the
  // clip should never be fetched for an intent the visitor has not looked at,
  // and never at all when reduced motion is asked for.
  if (active && !load && !reduced) setLoad(true);

  useEffect(() => {
    const v = ref.current;
    if (!v || !load) return;
    if (active) void v.play().catch(() => {});
    else v.pause();
  }, [active, load]);

  return (
    <>
      <Image
        src={poster}
        alt=""
        fill
        sizes="(max-width: 1024px) 100vw, 34vw"
        loading="lazy"
        className="object-cover"
      />
      {load && (
        <video
          ref={ref}
          muted
          loop
          playsInline
          preload="auto"
          poster={poster}
          aria-hidden
          className="absolute inset-0 h-full w-full object-cover"
        >
          <source src={video} type="video/mp4" />
        </video>
      )}
    </>
  );
}

export function PropertySearch() {
  // The intent frame and the per-option strip are alternatives, not both: only
  // the one actually on screen is allowed to load its clip.
  const isDesktop = useMediaQuery(DESKTOP);
  const [intent, setIntent] = useState<Intent>("buy");
  const [hovered, setHovered] = useState<Intent | null>(null);
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const router = useRouter();

  const shown = hovered ?? intent;

  return (
    <section
      id="search"
      data-nav-tone="dark"
      className="relative bg-ink py-[var(--spacing-section)] text-ivory"
    >
      <div className="shell">
        <SectionLabel index="02">Property Search</SectionLabel>

        <h2 data-reveal="up" className="display-lg mt-7 max-w-[14ch]">
          What are you<br />looking for?
        </h2>

        <div className="mt-14 grid gap-10 lg:mt-20 lg:grid-cols-[1fr_minmax(20rem,34%)] lg:gap-16">
          {/* intents */}
          <ul className="border-t border-ivory/12" onMouseLeave={() => setHovered(null)}>
            {INTENTS.map((item, i) => {
              const active = intent === item.id;
              const lit = shown === item.id;
              return (
                <li key={item.id} data-reveal="up" className="border-b border-ivory/12">
                  <button
                    type="button"
                    onMouseEnter={() => setHovered(item.id)}
                    onFocus={() => setHovered(item.id)}
                    onClick={() => setIntent(item.id)}
                    aria-pressed={active}
                    className="group grid w-full grid-cols-[auto_1fr] items-center gap-x-6 py-7 text-left sm:py-9"
                  >
                    <span
                      className={`label transition-colors duration-500 ${lit ? "text-champagne" : "text-ivory/35"}`}
                    >
                      0{i + 1}
                    </span>

                    <span className="flex items-baseline gap-5 overflow-hidden">
                      <span
                        className={`display-md inline-block transition-[transform,color] duration-700 [transition-timing-function:var(--ease-editorial)] ${
                          lit ? "translate-x-2 text-ivory" : "translate-x-0 text-ivory/55"
                        }`}
                      >
                        {item.label}
                      </span>
                      <span
                        aria-hidden
                        className={`hidden h-px flex-1 origin-left transition-transform duration-700 [transition-timing-function:var(--ease-editorial)] sm:block ${
                          lit ? "scale-x-100 bg-gold" : "scale-x-0 bg-ivory/20"
                        }`}
                      />
                      <span
                        className={`hidden shrink-0 text-champagne transition-opacity duration-500 sm:inline ${
                          active ? "opacity-100" : "opacity-0"
                        }`}
                        aria-hidden
                      >
                        ●
                      </span>
                    </span>

                    <span className="col-start-2 mt-3 block max-w-[42ch] text-sm font-light leading-relaxed text-ivory/50">
                      {item.blurb}
                    </span>

                    {/* mobile keeps a small frame with each option */}
                    <span className="relative col-start-2 mt-5 block h-40 w-full overflow-hidden bg-black lg:hidden">
                      <IntentLoop poster={item.media.poster} video={item.media.video} active={lit && !isDesktop} />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          {/* cross-fading frame */}
          <div data-reveal="fade" className="relative hidden aspect-[3/4] overflow-hidden bg-black lg:block">
            {INTENTS.map((item) => (
              <span
                key={item.id}
                className={`absolute inset-0 block transition-[opacity,transform] duration-[1100ms] [transition-timing-function:var(--ease-editorial)] ${
                  shown === item.id ? "scale-100 opacity-100" : "scale-[1.06] opacity-0"
                }`}
              >
                <IntentLoop poster={item.media.poster} video={item.media.video} active={shown === item.id && isDesktop} />
              </span>
            ))}
            <div className="pointer-events-none absolute inset-0 scrim-bottom" aria-hidden />
            <p className="label absolute bottom-6 left-6 text-ivory/80">
              {INTENTS.find((x) => x.id === shown)?.label} in {site.city}
            </p>
          </div>
        </div>

        {/* filters */}
        <form
          className="mt-16 lg:mt-24"
          onSubmit={(e) => {
            e.preventDefault();
            router.push(`/properties${filtersToQuery(filters, intent)}`);
          }}
        >
          <PropertyFilters value={filters} onChange={setFilters} />
          <div className="mt-10 flex flex-wrap items-center justify-between gap-6 border-t border-ivory/12 pt-8">
            <p className="label text-ivory/40">
              Searching <span className="text-champagne">{intent}</span> · {site.city}
            </p>
            <button
              type="submit"
              className="label-lg group inline-flex items-center gap-3 bg-ivory px-9 py-4 text-ink transition-colors duration-500 hover:bg-champagne"
            >
              Search properties
              <span className="arrow-slide" aria-hidden>→</span>
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}
