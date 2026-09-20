"use client";

import Link from "next/link";
import { useSiteProfile } from "@/components/site/SiteProfileProvider";
import { brandLockup } from "@/lib/site/profile";

/* ----------------------------------------------------------------------------
   Wordmark lockup: the mark plus the CONFIGURED agency name (never a hard-coded
   brand). The first word sits large, the rest underneath.

   Drawn as inline SVG so it inherits colour from its surroundings (ivory over
   dark sections, espresso over light ones) with the gold mark constant.

   To use the agency's own artwork instead: replace the <g id="mark"> path with
   the supplied one, or swap the whole component for an <Image> pointing at the
   supplied file — the sizing wrapper stays the same.
---------------------------------------------------------------------------- */

export function LogoMark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 44 40" aria-hidden className={className} fill="none">
      <g id="mark" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round">
        <path d="M4 34 22 5l18 29" />
        <path d="M13.2 19.2h17.6" />
      </g>
    </svg>
  );
}

export function Logo({
  className = "",
  href = "/",
  label,
}: {
  className?: string;
  href?: string | null;
  label?: string;
}) {
  const { brandName } = useSiteProfile();
  const [first, rest] = brandLockup(brandName);
  const inner = (
    <span className={`flex items-center gap-3 ${className}`}>
      <LogoMark className="h-7 w-auto text-gold shrink-0" />
      <span className="flex flex-col leading-none">
        <span className="font-display text-[1.42rem] tracking-[0.34em] pl-[0.34em] leading-none">{first}</span>
        {rest && <span className="label mt-[0.28rem] text-[0.5rem] tracking-[0.52em] opacity-80">{rest}</span>}
      </span>
    </span>
  );

  if (!href) return inner;
  return (
    <Link href={href} aria-label={label ?? `${brandName} — home`} className="inline-flex shrink-0">
      {inner}
    </Link>
  );
}
