"use client";

import { useEffect, useRef } from "react";
import { gsap, prefersReducedMotion } from "@/lib/motion";

/* ----------------------------------------------------------------------------
   Closing-section backdrop: Ararat at dusk over the Yerevan skyline, drawn in
   SVG instead of a photograph. When the section scrolls into view the skyline
   draws itself in gold, windows light up one by one and the mountain drifts
   slowly (parallax). Static and complete with reduced motion.
---------------------------------------------------------------------------- */

/* Deterministic pseudo-random numbers, so server and client draw the same scene. */
function rng(seed: number) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

const W = 1600;
const BASE = 900;

function skyline() {
  const r = rng(7);
  let x = 0;
  let d = `M 0 ${BASE}`;
  const windows: { x: number; y: number; delay: number }[] = [];
  while (x < W) {
    const w = 38 + Math.floor(r() * 70);
    const tall = r() > 0.82;
    const h = tall ? 150 + r() * 90 : 50 + r() * 95;
    const top = BASE - h;
    d += ` L ${x} ${top} L ${x + w} ${top}`;
    for (let wy = top + 14; wy < BASE - 12; wy += 22) {
      for (let wx = x + 8; wx < x + w - 8; wx += 16) {
        if (r() > 0.78) windows.push({ x: wx, y: wy, delay: r() * 4 });
      }
    }
    x += w;
    d += ` L ${x} ${BASE - (20 + r() * 30)}`;
  }
  d += ` L ${W} ${BASE}`;
  return { d, windows };
}

const SKY = skyline();
const STARS = (() => {
  const r = rng(42);
  return Array.from({ length: 70 }, () => ({ x: r() * W, y: r() * 380, s: 0.6 + r() * 1.4, delay: r() * 5 }));
})();

export function CtaBackdrop() {
  const root = useRef<SVGSVGElement>(null);
  const mountain = useRef<SVGGElement>(null);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const draw = () => el.classList.add("is-drawn");
    if (prefersReducedMotion()) { draw(); return; }
    const io = new IntersectionObserver((e) => {
      if (e.some((x) => x.isIntersecting)) { draw(); io.disconnect(); }
    }, { threshold: 0.25 });
    io.observe(el);
    const tween = mountain.current
      ? gsap.fromTo(mountain.current, { y: 40 }, {
          y: -30, ease: "none",
          scrollTrigger: { trigger: el, start: "top bottom", end: "bottom top", scrub: true },
        })
      : null;
    return () => { io.disconnect(); tween?.scrollTrigger?.kill(); tween?.kill(); };
  }, []);

  return (
    <svg
      ref={root}
      viewBox={`0 0 ${W} ${BASE}`}
      preserveAspectRatio="xMidYMax slice"
      aria-hidden
      className="cta-scene absolute inset-0 h-full w-full"
    >
      <defs>
        <linearGradient id="ctaSky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#07070a" />
          <stop offset="0.55" stopColor="#14100d" />
          <stop offset="0.85" stopColor="#3a2617" />
          <stop offset="1" stopColor="#5b3a1f" />
        </linearGradient>
        <radialGradient id="ctaGlow" cx="0.5" cy="0.62" r="0.55">
          <stop offset="0" stopColor="#e1b377" stopOpacity="0.32" />
          <stop offset="1" stopColor="#e1b377" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="ctaMount" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2b2420" />
          <stop offset="1" stopColor="#120e0c" />
        </linearGradient>
        <linearGradient id="ctaSnow" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f4efe7" stopOpacity="0.55" />
          <stop offset="1" stopColor="#c9b79f" stopOpacity="0.15" />
        </linearGradient>
      </defs>

      <rect width={W} height={BASE} fill="url(#ctaSky)" />
      <rect width={W} height={BASE} fill="url(#ctaGlow)" />

      {STARS.map((s, i) => (
        <circle key={i} cx={s.x} cy={s.y} r={s.s} fill="#f4efe7" className="cta-star" style={{ animationDelay: `${s.delay}s` }} />
      ))}

      {/* Masis and Sis */}
      <g ref={mountain}>
        {/* Masis sits at the centre so a phone (portrait crop) shows the summit. */}
        <g transform="translate(180 0)">
        <path
          d="M0 760 C 200 720 350 640 470 520 C 540 450 590 360 620 330 C 650 360 700 430 780 500 C 850 560 900 560 960 520 C 1000 495 1030 470 1050 470 C 1080 480 1120 520 1180 570 C 1300 660 1450 720 1600 750 L 1600 900 L 0 900 Z"
          fill="url(#ctaMount)"
        />
        <path d="M 560 400 C 590 360 605 340 620 330 C 640 350 660 375 690 410 C 670 400 652 416 636 401 C 615 420 590 404 560 400 Z" fill="url(#ctaSnow)" />
        <path d="M 1020 488 C 1035 476 1045 470 1050 470 C 1062 474 1072 482 1085 494 C 1071 490 1060 497 1050 490 C 1040 497 1030 492 1020 488 Z" fill="url(#ctaSnow)" />
        </g>
      </g>

      {/* city */}
      <path d={SKY.d} fill="#0b0908" />
      <path d={SKY.d} fill="none" stroke="#c49b5b" strokeWidth="1.4" strokeOpacity="0.75" pathLength={1} className="cta-line" />
      {SKY.windows.map((w, i) => (
        <rect key={i} x={w.x} y={w.y} width="6" height="8" fill="#e1b377" className="cta-window" style={{ transitionDelay: `${1.2 + w.delay}s` }} />
      ))}
    </svg>
  );
}
