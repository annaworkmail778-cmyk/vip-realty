"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { SectionLabel } from "@/components/ui/SectionLabel";
import { ArrowLink } from "@/components/ui/ArrowLink";
import { gsap, prefersReducedMotion, useIsoLayoutEffect } from "@/lib/motion";
import { media } from "@/lib/media";
import { useDict } from "@/components/site/LocaleProvider";

/* ----------------------------------------------------------------------------
   04 — From space to possibility.

   The video never plays itself. Scroll position drives `currentTime`:
   down advances, up reverses, stopping freezes the frame.

   Two things matter here:

   · The ScrollTrigger is built on mount, not when the video arrives. Creating a
     pin later would insert its spacer into an already-scrolled page and throw
     off every trigger below it.
   · `duration` is only read once `loadedmetadata` has fired, so a NaN never
     reaches currentTime. Until then the poster holds the frame.

   The file itself is still deferred: preload="none" plus a manual load() once
   the section is roughly a viewport away.
---------------------------------------------------------------------------- */

export function TransformationSection() {
  const dict = useDict();
  const stages = dict.transformation.stages;
  const root = useRef<HTMLElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const duration = useRef(0);
  const [stage, setStage] = useState(0);
  const [ready, setReady] = useState(false);

  // Fetch the clip only once the section is within reach.
  useEffect(() => {
    const el = root.current;
    const v = video.current;
    if (!el || !v) return;

    const onMeta = () => {
      if (Number.isFinite(v.duration) && v.duration > 0) {
        duration.current = v.duration;
        setReady(true);
      }
    };
    v.addEventListener("loadedmetadata", onMeta);

    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          v.load();
          io.disconnect();
        }
      },
      { rootMargin: "120% 0px" },
    );
    io.observe(el);

    return () => {
      v.removeEventListener("loadedmetadata", onMeta);
      io.disconnect();
    };
  }, []);

  // Read once so the scroll timeline does not depend on the dictionary object.
  const stageCount = stages.length;

  useIsoLayoutEffect(() => {
    const el = root.current;
    if (!el || prefersReducedMotion()) return;

    const ctx = gsap.context(() => {
      const progress = { t: 0 };

      gsap.to(progress, {
        t: 1,
        ease: "none",
        scrollTrigger: {
          trigger: el,
          start: "top top",
          // Shorter on phones: every scroll tick seeks the file, and a long
          // pin there costs more than it adds.
          end: () => `+=${Math.round(window.innerHeight * (window.innerWidth < 1024 ? 2.5 : 4))}`,
          pin: true,
          scrub: true,
          anticipatePin: 1,
          invalidateOnRefresh: true,
        },
        onUpdate: () => {
          const v = video.current;
          const d = duration.current;
          if (!v || !d) return;
          // Clamp just short of the end: seeking to exactly duration can drop
          // the last frame and show black.
          v.currentTime = Math.min(progress.t * d, d - 0.05);

          const next = Math.min(stageCount - 1, Math.floor(progress.t * stageCount));
          setStage((prev) => (prev === next ? prev : next));
        },
      });
    }, el);

    return () => ctx.revert();
  }, [stageCount]);

  return (
    <section
      ref={root}
      data-nav-tone="dark"
      className="relative h-[100svh] min-h-[34rem] w-full overflow-hidden bg-black text-ivory"
    >
      <div className="media-fill">
        {/* Poster holds the opening frame until the clip has data of its own. */}
        <Image
          src={media.transformation.poster}
          alt=""
          fill
          sizes="100vw"
          loading="lazy"
          className={`object-cover transition-opacity duration-700 ${ready ? "opacity-0" : "opacity-100"}`}
        />
        <video
          ref={video}
          muted
          playsInline
          preload="none"
          poster={media.transformation.poster}
          aria-hidden
          tabIndex={-1}
          className="absolute inset-0 h-full w-full object-cover"
        >
          <source src={media.transformation.webm} type="video/webm" />
          <source src={media.transformation.mp4} type="video/mp4" />
        </video>
      </div>

      <div className="pointer-events-none absolute inset-0 scrim-film" aria-hidden />

      <div className="shell relative flex h-full flex-col pb-[clamp(1.5rem,4vh,3rem)] pt-[calc(var(--nav-h)+clamp(1.5rem,6vh,4rem))]">
        <div>
          <SectionLabel index="04">{dict.transformation.label}</SectionLabel>
          <h2 className="display-md mt-6 max-w-[12ch]">
            {dict.transformation.title[0]}<br />{dict.transformation.title[1]}
          </h2>
        </div>

        <div className="mt-auto">
          <p className="display-sm text-ivory">{dict.transformation.lead}</p>

          <div className="mt-6 flex flex-wrap items-end justify-between gap-x-10 gap-y-5 border-t border-ivory/12 pt-5">
            <ol className="flex flex-wrap items-center gap-x-4 gap-y-2">
              {stages.map((s, i) => (
                <li key={s} className="flex items-center gap-4">
                  <span
                    className={`label whitespace-nowrap transition-colors duration-500 ${
                      i === stage ? "text-champagne" : i < stage ? "text-ivory/55" : "text-ivory/25"
                    }`}
                  >
                    {s}
                  </span>
                  {i < stages.length - 1 && (
                    <span
                      aria-hidden
                      className={`hidden h-px w-5 transition-colors duration-500 sm:block ${
                        i < stage ? "bg-gold/70" : "bg-ivory/15"
                      }`}
                    />
                  )}
                </li>
              ))}
            </ol>

            <ArrowLink href="/properties" className="hidden lg:inline-flex">
              {dict.hero.explore}
            </ArrowLink>
          </div>

          <p className="label mt-4 text-ivory/35">{dict.transformation.hint}</p>
        </div>
      </div>
    </section>
  );
}
