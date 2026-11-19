"use client";

import { useRef } from "react";
import Link from "next/link";
import { ButtonLink } from "@/components/ui/ArrowLink";
import { gsap, useGsap } from "@/lib/motion";
import { media } from "@/lib/media";
import { useDict } from "@/components/site/LocaleProvider";
import { useSiteProfile } from "@/components/site/SiteProfileProvider";

/* ----------------------------------------------------------------------------
   01 — Hero.
   Phones show the text-free Ararat crop of the agency's key visual; wider
   screens the architectural still (until a text-free 16:9 key visual exists).
   Overlay at every size: blessing, headline, copy and actions. A slow push-in, scroll
   parallax and (with a mouse) a gentle 3D tilt bring the still to life.
---------------------------------------------------------------------------- */

/* Quick entry points into the index; labels come from the navigation dictionary. */
const QUICK = [
  { key: "buy", href: "/properties?intent=buy" },
  { key: "rent", href: "/properties?intent=rent" },
  { key: "land", href: "/properties?intent=land" },
] as const;

export function Hero() {
  const { brandName } = useSiteProfile();
  const dict = useDict();
  const root = useRef<HTMLElement>(null);

  useGsap(() => {
    // fromTo rather than from: explicit end values keep the entrance correct
    // even if a previous context left inline styles on these nodes.
    const tl = gsap.timeline({ defaults: { ease: "power3.out" } });
    tl.fromTo("[data-hero='media']", { scale: 1.08 }, { scale: 1, duration: 2.6, ease: "power2.out" }, 0)
      .fromTo("[data-hero='label']", { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 1 }, 0.35)
      .fromTo("[data-hero='blessing']", { opacity: 0, y: 10, letterSpacing: "0.3em" }, { opacity: 1, y: 0, letterSpacing: "0.08em", duration: 1.6 }, 0.3)
      .fromTo("[data-hero='line']", { yPercent: 112 }, { yPercent: 0, duration: 1.35, stagger: 0.09, ease: "expo.out" }, 0.45)
      .fromTo("[data-hero='copy']", { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 1 }, 1.1)
      .fromTo("[data-hero='cta'] > *", { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.9, stagger: 0.1 }, 1.25)
      .fromTo("[data-hero='quick'] > *", { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.7, stagger: 0.07 }, 1.45)
      .fromTo("[data-hero='scroll']", { opacity: 0 }, { opacity: 1, duration: 1 }, 1.6);

    // Pointer tilt: the picture leans a few degrees toward the cursor (mouse only).
    const el = root.current;
    const media = el?.querySelector<HTMLElement>("[data-hero='tilt']");
    let off: (() => void) | undefined;
    if (el && media && window.matchMedia("(pointer: fine)").matches) {
      const rx = gsap.quickTo(media, "rotationX", { duration: 1.2, ease: "power3.out" });
      const ry = gsap.quickTo(media, "rotationY", { duration: 1.2, ease: "power3.out" });
      const onMove = (e: PointerEvent) => {
        const b = el.getBoundingClientRect();
        ry(((e.clientX - b.left) / b.width - 0.5) * 3);
        rx(-((e.clientY - b.top) / b.height - 0.5) * 2.2);
      };
      el.addEventListener("pointermove", onMove);
      off = () => el.removeEventListener("pointermove", onMove);
    }

    // Content drifts up and dims as the next section arrives.
    gsap.to("[data-hero='content']", {
      yPercent: -14,
      opacity: 0,
      ease: "none",
      scrollTrigger: { trigger: root.current, start: "top top", end: "bottom top", scrub: true },
    });
    gsap.to("[data-hero='media']", {
      yPercent: 12,
      ease: "none",
      scrollTrigger: { trigger: root.current, start: "top top", end: "bottom top", scrub: true },
    });
    return off;
  }, root);

  return (
    <section
      ref={root}
      data-nav-tone="dark"
      className="relative h-[100svh] min-h-[34rem] w-full overflow-hidden bg-black"
    >
      <div className="media-fill [perspective:1400px]" data-hero="media">
        {/* Art directed: phones get the text-free portrait crop, wider screens the whole key visual. */}
        <picture data-hero="tilt" className="block h-full w-full scale-[1.04] will-change-transform">
          {/* Wider screens keep the previous still until a text-free 16:9 version of the key visual exists;
              then point media.hero.image at it. */}
          <source media="(max-width: 639px)" srcSet={media.hero.brandPortrait} />
          <img
            src={media.hero.image}
            alt=""
            fetchPriority="high"
            decoding="async"
            className="h-full w-full object-cover object-[50%_55%]"
          />
        </picture>
      </div>

      {/* Phone: full scrim for the text. Wider: only a soft fade at the bottom for the actions. */}
      <div className="absolute inset-0 scrim-full" aria-hidden />

      <div className="shell relative flex h-full flex-col pb-[clamp(2rem,6vh,4rem)]" data-hero="content">
        <p data-hero="label" className="label pt-[calc(var(--nav-h)+clamp(1.5rem,7vh,4rem))] text-ivory/70">
          <span className="text-champagne">{brandName.toUpperCase()}</span>
          <span className="mx-3 opacity-40">/</span>
          {dict.brand.tagline}
        </p>

        {/* The agency's blessing to every visitor, in the brand gold. */}
        <p data-hero="blessing" className="mt-auto font-display text-[clamp(1.15rem,2.4vw,1.6rem)] italic tracking-[0.08em] text-champagne">
          {dict.hero.blessing}
        </p>

        <h1 className="display-xl mt-3 text-ivory">
          {dict.hero.headline.map((line) => (
            <span key={line} className="-mb-[0.18em] block overflow-hidden pb-[0.18em]">
              <span data-hero="line" className="block">
                {line}
              </span>
            </span>
          ))}
        </h1>

        <div className="mt-8 flex flex-col gap-8 md:flex-row md:items-end md:justify-between">
          <p data-hero="copy" className="measure text-[1.02rem] font-light leading-relaxed text-ivory/75">
            {dict.hero.copy}
          </p>

          <div className="flex flex-col gap-4 md:items-end">
            <div data-hero="cta" className="flex flex-wrap items-center gap-3 sm:gap-4">
              <ButtonLink href="/properties">{dict.hero.explore}</ButtonLink>
              <ButtonLink href="/#contact" variant="outline">{dict.contact.contactUs}</ButtonLink>
            </div>
            {/* One tap straight into what most visitors came for. */}
            <nav data-hero="quick" aria-label={dict.nav.search} className="flex flex-wrap gap-2">
              {QUICK.map((q) => (
                <Link
                  key={q.key}
                  href={q.href}
                  className="label rounded-full border border-ivory/25 bg-black/20 px-4 py-2 text-ivory/85 backdrop-blur-sm transition-colors duration-500 hover:border-champagne hover:text-champagne"
                >
                  {dict.nav[q.key]}
                </Link>
              ))}
            </nav>
          </div>
        </div>

        <div className="mt-8 flex items-center justify-between border-t border-ivory/12 pt-5" data-hero="scroll">
          <a href="#search" className="label group flex items-center gap-3 text-ivory/60 transition-colors hover:text-ivory">
            {dict.hero.scroll}
            <span className="inline-block animate-[bounce_2.8s_ease-in-out_infinite] text-champagne" aria-hidden>↓</span>
          </a>
          <p className="label hidden text-ivory/40 sm:block">{dict.brand.city}, {dict.brand.country}</p>
        </div>
      </div>
    </section>
  );
}
