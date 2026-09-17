"use client";

import { useEffect } from "react";
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
    });

    // Late-loading webfonts change layout; recalculate trigger positions.
    document.fonts?.ready.then(() => ScrollTrigger.refresh()).catch(() => {});
    const onLoad = () => ScrollTrigger.refresh();
    window.addEventListener("load", onLoad);

    return () => {
      window.removeEventListener("load", onLoad);
      ctx.revert();
    };
  }, [pathname]);

  return null;
}
