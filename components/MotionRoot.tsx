"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { gsap, ScrollTrigger, prefersReducedMotion } from "@/lib/motion";

/* ----------------------------------------------------------------------------
   One place that owns the site-wide reveal behaviour.

   Any element marked `data-reveal="up" | "fade" | "mask"` is hidden by CSS
   (only once this component confirms motion is wanted) and revealed as it
   enters the viewport, batched so siblings stagger together rather than
   firing one trigger each.
---------------------------------------------------------------------------- */

const TO: Record<string, gsap.TweenVars> = {
  up: { opacity: 1, y: 0, duration: 1.1, ease: "power3.out" },
  fade: { opacity: 1, duration: 1.3, ease: "power2.out" },
  mask: { opacity: 1, clipPath: "inset(0 0 0% 0)", duration: 1.2, ease: "power3.out" },
};

export function MotionRoot() {
  const pathname = usePathname();
  const fromHistory = useRef(false);

  /* Back/forward keeps the browser's own scroll restoration; every other route change starts at the top.
     Without this, opening a listing from far down the home page (whose pinned sections confuse the router's
     own scroll handling) landed the visitor at the bottom of the property page. */
  useEffect(() => {
    const onPop = () => { fromHistory.current = true; };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  useEffect(() => {
    if (fromHistory.current) { fromHistory.current = false; return; }
    if (!window.location.hash) window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [pathname]);

  useEffect(() => {
    if (prefersReducedMotion()) return;
    document.documentElement.classList.add("motion-on");
    return () => document.documentElement.classList.remove("motion-on");
  }, []);

  useEffect(() => {
    if (prefersReducedMotion()) return;

    // Mobile browsers resize the viewport when the URL bar hides; refreshing
    // pinned sections on that makes scrolling jump.
    ScrollTrigger.config({ ignoreMobileResize: true });

    const ctx = gsap.context(() => {
      for (const kind of Object.keys(TO)) {
        ScrollTrigger.batch(`[data-reveal="${kind}"]`, {
          start: "top 88%",
          once: true,
          onEnter: (batch) =>
            gsap.to(batch, { ...TO[kind], stagger: { each: 0.08, from: "start" }, overwrite: "auto" }),
        });
      }

      /* Numbers count up once when they enter the view: "1000+", "2022". */
      gsap.utils.toArray<HTMLElement>("[data-count]").forEach((el) => {
        const to = Number(el.dataset.count);
        const from = Number(el.dataset.countFrom ?? 0);
        const suffix = el.dataset.suffix ?? "";
        if (!Number.isFinite(to)) return;
        const state = { v: from };
        el.textContent = `${from}${suffix}`;
        gsap.to(state, {
          v: to,
          duration: 2,
          ease: "power2.out",
          scrollTrigger: { trigger: el, start: "top 90%", once: true },
          onUpdate: () => { el.textContent = `${Math.round(state.v)}${suffix}`; },
        });
      });

      /* Gentle depth on large images: they drift a little slower than the page. */
      gsap.utils.toArray<HTMLElement>("[data-parallax]").forEach((el) => {
        const amount = Number(el.dataset.parallax) || 8;
        gsap.fromTo(el, { yPercent: -amount }, {
          yPercent: amount,
          ease: "none",
          scrollTrigger: { trigger: el.parentElement ?? el, start: "top bottom", end: "bottom top", scrub: true },
        });
      });

    }); // end context

    /* 3D tilt on cards (mouse only): the card leans toward the cursor and a soft glare follows it. */
    const offs: (() => void)[] = [];
    if (window.matchMedia("(pointer: fine)").matches) {
      document.querySelectorAll<HTMLElement>("[data-tilt]").forEach((card) => {
        const rx = gsap.quickTo(card, "rotationX", { duration: 0.6, ease: "power3.out" });
        const ry = gsap.quickTo(card, "rotationY", { duration: 0.6, ease: "power3.out" });
        const move = (e: PointerEvent) => {
          const b = card.getBoundingClientRect();
          const x = (e.clientX - b.left) / b.width, y = (e.clientY - b.top) / b.height;
          ry((x - 0.5) * 7);
          rx(-(y - 0.5) * 6);
          card.style.setProperty("--gx", `${x * 100}%`);
          card.style.setProperty("--gy", `${y * 100}%`);
        };
        const leave = () => { rx(0); ry(0); };
        card.addEventListener("pointermove", move);
        card.addEventListener("pointerleave", leave);
        offs.push(() => { card.removeEventListener("pointermove", move); card.removeEventListener("pointerleave", leave); });
      });
    }

    // Late-loading webfonts change layout; recalculate trigger positions.
    document.fonts?.ready.then(() => ScrollTrigger.refresh()).catch(() => {});
    const onLoad = () => ScrollTrigger.refresh();
    window.addEventListener("load", onLoad);

    return () => {
      offs.forEach((off) => off());
      window.removeEventListener("load", onLoad);
      ctx.revert();
    };
  }, [pathname]);

  return null;
}
