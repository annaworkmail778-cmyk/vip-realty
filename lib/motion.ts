"use client";

import { useEffect, useLayoutEffect, useSyncExternalStore, type RefObject } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

if (typeof window !== "undefined") gsap.registerPlugin(ScrollTrigger);

export { gsap, ScrollTrigger };

export const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

export function prefersReducedMotion() {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

const REDUCE_QUERY = "(prefers-reduced-motion: reduce)";

/**
 * Reactive version of the above, for components that decide what to render
 * rather than what to animate. The server snapshot is `true` so no autoplaying
 * markup is ever sent in the HTML; the client corrects it on hydration.
 */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const m = window.matchMedia(REDUCE_QUERY);
      m.addEventListener("change", onChange);
      return () => m.removeEventListener("change", onChange);
    },
    () => window.matchMedia(REDUCE_QUERY).matches,
    () => true,
  );
}

/**
 * Scoped GSAP context. Everything created inside `setup` is reverted on
 * unmount, which keeps pinned sections from leaking spacers across routes.
 */
export function useGsap(
  setup: (ctx: { scope: HTMLElement }) => void | (() => void),
  scope: RefObject<HTMLElement | null>,
  deps: unknown[] = [],
) {
  useIsoLayoutEffect(() => {
    const el = scope.current;
    if (!el || prefersReducedMotion()) return;
    let cleanup: void | (() => void);
    const ctx = gsap.context(() => {
      cleanup = setup({ scope: el });
    }, el);
    return () => {
      cleanup?.();
      ctx.revert();
    };
  }, deps);
}

/** The breakpoint above which pinned, scrubbed layouts are used. */
export const DESKTOP = "(min-width: 1024px)";

/**
 * Subscribe to a media query. For components that render different markup per
 * breakpoint rather than merely styling it — so a hidden element does not
 * quietly download a video the visitor will never see.
 */
export function useMediaQuery(query: string, serverSnapshot = false): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const m = window.matchMedia(query);
      m.addEventListener("change", onChange);
      return () => m.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => serverSnapshot,
  );
}
