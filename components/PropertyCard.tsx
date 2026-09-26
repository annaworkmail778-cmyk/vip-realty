"use client";

import Image from "next/image";
import Link from "next/link";
import { districtFirstLine } from "@/lib/listings/format";
import { useDict, useFormat } from "@/components/site/LocaleProvider";
import type { Listing } from "@/lib/listings/types";

/* ----------------------------------------------------------------------------
   The listing card — one component for every place a listing appears as a tile:
   the index, the homepage's latest section, and "more from the selection" on a
   property page.

   It sits on the ivory inventory surface rather than the dark brand sections,
   because a grid of property photography needs a light ground to read as
   inventory instead of as a moodboard. The motion language is the site's own:
   `.img-zoom` on the image, the card lifting on `.group:hover`.

   Every value comes from the published listing. Unknown facts are omitted, never
   shown as zero or a placeholder, and a listing without photography gets a
   composed fallback rather than an empty frame.
---------------------------------------------------------------------------- */

export function PropertyCard({
  listing,
  priority = false,
  sizes = "(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw",
}: {
  listing: Listing;
  /** Eager-load the first cards in a grid; lazy-load the rest. */
  priority?: boolean;
  sizes?: string;
}) {
  const dict = useDict();
  const fmt = useFormat();
  const meta = fmt.meta(listing);
  const cover = listing.media.cover;
  const isRent = listing.intent === "rent";

  return (
    <Link href={`/properties/${listing.slug}`} className="group block h-full w-full">
      <article className="card flex h-full flex-col overflow-hidden">
        <div className="relative aspect-[4/3] overflow-hidden bg-ivory-3">
          {cover ? (
            <Image
              src={cover.url}
              alt={cover.alt}
              fill
              sizes={sizes}
              priority={priority}
              loading={priority ? undefined : "lazy"}
              className="img-zoom object-cover"
            />
          ) : (
            <ImageFallback typeLabel={fmt.type(listing)} note={dict.property.photographyToFollow} />
          )}

          <span
            className={`badge absolute left-3 top-3 ${
              isRent ? "bg-cocoa/95 text-ivory" : "bg-espresso/95 text-ivory"
            }`}
          >
            {fmt.intent(listing)}
          </span>

          {listing.priceNegotiable === true && (
            <span className="badge absolute right-3 top-3 bg-parchment/92 text-espresso">{dict.property.negotiable}</span>
          )}
        </div>

        <div className="flex flex-1 flex-col p-5 sm:p-6">
          <p className="price text-ink">{fmt.price(listing)}</p>

          <h3 className="display-xs mt-3 line-clamp-2 text-ink">{listing.name}</h3>

          <p className="label mt-2.5 text-cocoa">{districtFirstLine(listing)}</p>

          {/* Pushed to the bottom so cards of differing title length still align. */}
          <div className="mt-auto pt-5">
            {meta.length > 0 && (
              <>
                <div className="rule-ink" />
                <p className="label mt-3 text-espresso/70">{meta.join(" · ")}</p>
              </>
            )}
          </div>
        </div>
      </article>
    </Link>
  );
}

/* A listing can be published before its photography arrives. Compose something
   deliberate for that case rather than leaving a black rectangle. */
function ImageFallback({ typeLabel, note }: { typeLabel: string; note: string }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-ivory-2">
      <span className="h-px w-8 gold-rule" aria-hidden />
      <span className="label text-espresso/45">{typeLabel}</span>
      <span className="label text-espresso/30">{note}</span>
    </div>
  );
}
