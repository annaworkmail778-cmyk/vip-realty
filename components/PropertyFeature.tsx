import Image from "next/image";
import Link from "next/link";
import { ArrowLink } from "@/components/ui/ArrowLink";
import { formatPrice, locationLine, metaLine, positionLabel } from "@/lib/listings/format";
import type { Listing } from "@/lib/listings/types";

/* ----------------------------------------------------------------------------
   A single property, presented at full editorial scale.

   `stage`   — a layer in the scrubbed sequence (section 03), absolutely filling
               the sticky viewport.
   `stacked` — the same content as a standalone block, used on small screens and
               anywhere a scroll sequence would be wrong.
---------------------------------------------------------------------------- */

export function PropertyFeature({
  listing,
  position,
  variant = "stacked",
  priority = false,
}: {
  listing: Listing;
  /** Zero-based position in the sequence, shown as "01", "02", … */
  position: number;
  variant?: "stage" | "stacked";
  priority?: boolean;
}) {
  const stage = variant === "stage";
  const href = `/properties/${listing.slug}`;
  const cover = listing.media.cover;

  const meta = (
    <>
      <p data-feature="text" className="label text-champagne">{positionLabel(position)}</p>

      <h3 data-feature="text" className="display-md mt-5 text-ivory">
        <Link href={href} className="link-underline">{listing.name}</Link>
      </h3>

      <p data-feature="text" className="label mt-4 text-ivory/55">
        {locationLine(listing)}
      </p>

      <dl data-feature="text" className="mt-8 flex flex-wrap gap-x-8 gap-y-3 border-t border-ivory/12 pt-6">
        {metaLine(listing).map((m) => (
          <div key={m}>
            <dd className="label text-ivory/80">{m}</dd>
          </div>
        ))}
        <div>
          <dd className="label text-champagne">{formatPrice(listing)}</dd>
        </div>
      </dl>

      <div data-feature="text" className="mt-8">
        <ArrowLink href={href}>View property</ArrowLink>
      </div>
    </>
  );

  if (stage) {
    return (
      <article className="absolute inset-0 grid grid-cols-1 lg:grid-cols-[38%_1fr]">
        <div className="relative z-10 flex flex-col justify-center pl-[clamp(1.25rem,5vw,5.5rem)] pr-8">
          {meta}
        </div>
        <div className="relative overflow-hidden bg-black">
          {cover && (
            <Image
              data-feature="media"
              src={cover.url}
              alt={cover.alt}
              fill
              sizes="(max-width: 1024px) 100vw, 62vw"
              priority={priority}
              className="object-cover"
            />
          )}
          <div className="pointer-events-none absolute inset-y-0 left-0 w-40 bg-gradient-to-r from-ink to-transparent" aria-hidden />
        </div>
      </article>
    );
  }

  return (
    <article className="relative">
      <Link href={href} className="group block overflow-hidden">
        <div className="relative aspect-[4/5] w-full overflow-hidden bg-black sm:aspect-[16/10]">
          {cover && (
            <Image
              src={cover.url}
              alt={cover.alt}
              fill
              sizes="(max-width: 640px) 100vw, 60vw"
              loading="lazy"
              className="img-zoom object-cover"
            />
          )}
          <div className="pointer-events-none absolute inset-0 scrim-bottom" aria-hidden />
          <p className="label absolute left-5 top-5 text-champagne">{positionLabel(position)}</p>
        </div>
      </Link>
      <div className="mt-6">{meta}</div>
    </article>
  );
}
