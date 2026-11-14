"use client";

import Image from "next/image";
import Link from "next/link";
import { useSiteProfile } from "@/components/site/SiteProfileProvider";
import { useDict } from "@/components/site/LocaleProvider";
import { brandLockup } from "@/lib/site/profile";
import { media } from "@/lib/media";

/* ----------------------------------------------------------------------------
   Wordmark lockup: the agency's own gold mark (cut from the supplied logo,
   public/media/brand/vip-realty-mark.png) plus the CONFIGURED agency name
   (never a hard-coded brand). The first word sits large, the rest underneath.

   The name is live text so it inherits colour from its surroundings (ivory over
   dark sections, espresso over light ones); the gold mark stays constant.
---------------------------------------------------------------------------- */

export function LogoMark({ className = "" }: { className?: string }) {
  return (
    <Image src={media.brand.mark} alt="" width={254} height={315} aria-hidden className={className} />
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
  const dict = useDict();
  const [first, rest] = brandLockup(brandName);
  const inner = (
    <span className={`flex items-center gap-3 ${className}`}>
      <LogoMark className="h-9 w-auto shrink-0" />
      <span className="flex flex-col leading-none">
        <span className="font-display text-[1.42rem] tracking-[0.34em] pl-[0.34em] leading-none">{first}</span>
        {rest && <span className="wordmark mt-[0.28rem] text-[0.5rem] tracking-[0.52em] opacity-80">{rest}</span>}
      </span>
    </span>
  );

  if (!href) return inner;
  return (
    <Link href={href} aria-label={label ?? `${brandName} — ${dict.nav.home}`} className="inline-flex shrink-0">
      {inner}
    </Link>
  );
}
