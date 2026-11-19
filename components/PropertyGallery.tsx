"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useDict, useFormat } from "@/components/site/LocaleProvider";
import { fill } from "@/lib/i18n/fill";
import type { ListingImage } from "@/lib/listings/types";

/* Elegant gallery: an editorial layout that opens into a full-bleed lightbox.
   Images arrive in gallery order from property_images (Supabase Storage).

   Two layouts share one lightbox:
     "hero"  — the property page's opening frame: one large image plus a 2×2 of
               supporting shots on desktop, a single tall frame on a phone.
     "strip" — the original in-body grid, unchanged.

   The lightbox behaviour (keyboard, scroll lock, counter) is the existing
   implementation and is deliberately untouched. */
export function PropertyGallery({
  images,
  name,
  variant = "strip",
}: {
  images: ListingImage[];
  /** The listing's display title (`fmt.title`), already in the UI language. */
  name: string;
  variant?: "strip" | "hero";
}) {
  const dict = useDict();
  const fmt = useFormat();
  const [open, setOpen] = useState<number | null>(null);
  const openLabel = (i: number) =>
    fill(dict.gallery.open, { index: i + 1, total: images.length });
  // A photo without stored alt text is described by the title and its position.
  const altOf = (i: number) => images[i].alt || fmt.imageAlt(name, i + 1);

  const move = useCallback(
    (delta: number) => setOpen((i) => (i === null ? null : (i + delta + images.length) % images.length)),
    [images.length],
  );

  useEffect(() => {
    if (open === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
      if (e.key === "ArrowRight") move(1);
      if (e.key === "ArrowLeft") move(-1);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = ""; window.removeEventListener("keydown", onKey); };
  }, [open, move]);

  /* Lightbox swipe: a horizontal drag of 50 px or more moves one photo. */
  const touch = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => { touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; };
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touch.current;
    touch.current = null;
    if (!start) return;
    const dx = e.changedTouches[0].clientX - start.x;
    const dy = e.changedTouches[0].clientY - start.y;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) move(dx < 0 ? 1 : -1);
  };

  if (images.length === 0) return null;

  const supporting = images.slice(1, 5);
  const hidden = Math.max(0, images.length - 1 - supporting.length);

  // With fewer than four supporting shots a fixed 2x2 would leave empty cells, so
  // the track adapts: one fills the column, two stack, three fill a 2x2 with the
  // first spanning the top row.
  const supportingGrid =
    supporting.length === 1 ? "grid-cols-1 grid-rows-1"
      : supporting.length === 2 ? "grid-cols-1 grid-rows-2"
        : "grid-cols-2 grid-rows-2";

  return (
    <>
      {variant === "hero" ? (
        <div>
          <div className="grid gap-2 lg:aspect-[16/9] lg:grid-cols-[1.7fr_1fr]">
            {/* Phone and tablet: every photo in a swipeable track, tap opens the lightbox. */}
            <SwipeTrack images={images} altOf={altOf} labelOf={openLabel} onOpen={setOpen} />
            <Frame
              image={images[0]}
              alt={altOf(0)}
              index={0}
              total={images.length}
              onOpen={setOpen}
              label={openLabel(0)}
              priority
              sizes="62vw"
              className="hidden lg:block lg:h-full"
            />

            {supporting.length > 0 && (
              <div className={`hidden gap-2 lg:grid ${supportingGrid}`}>
                {supporting.map((image, i) => {
                  const index = i + 1;
                  const last = i === supporting.length - 1 && hidden > 0;
                  const span = supporting.length === 3 && i === 0 ? "col-span-2" : "";
                  return (
                    <Frame
                      key={image.url}
                      image={image}
                      alt={altOf(index)}
                      index={index}
                      total={images.length}
                      onOpen={setOpen}
                      label={openLabel(index)}
                      sizes="20vw"
                      className={`h-full ${span}`}
                      overlay={last ? `+${hidden}` : undefined}
                    />
                  );
                })}
              </div>
            )}
          </div>

          {/* Shown at every breakpoint. On a phone it is the only way into the
              gallery; on desktop the thumbnail rail's "+N" badge is too quiet to
              advertise that the rest of the photography exists. The count comes
              straight from `images.length`, so it is also the honest statement
              of how many photographs the listing actually has. */}
          {images.length > 1 && (
            <button
              type="button"
              onClick={() => setOpen(0)}
              className="label mt-3 hidden lg:inline-flex items-center gap-2.5 text-espresso/70 transition-colors duration-500 hover:text-espresso"
            >
              <span className="link-underline">
                {fill(dict.gallery.viewAll, { count: images.length })}
              </span>
              <span aria-hidden>→</span>
            </button>
          )}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {images.map((image, i) => (
            <Frame
              key={image.url}
              image={image}
              alt={altOf(i)}
              index={i}
              total={images.length}
              onOpen={setOpen}
              label={openLabel(i)}
              sizes="(max-width: 640px) 100vw, 46vw"
              className={i === 0 ? "aspect-[16/10] sm:col-span-2" : "aspect-[4/3]"}
              counter
            />
          ))}
        </div>
      )}

      {open !== null && images[open] && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={fill(dict.gallery.of, { name })}
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/95 p-4"
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
        >
          <button
            type="button"
            onClick={() => setOpen(null)}
            aria-label={dict.gallery.close}
            className="absolute inset-0 h-full w-full cursor-default"
          />
          <div className="relative h-[76vh] w-full max-w-6xl">
            <Image
              src={images[open].url}
              alt={altOf(open)}
              fill
              sizes="90vw"
              className="object-contain"
              priority
            />
          </div>
          <div className="absolute inset-x-0 bottom-6 flex items-center justify-center gap-10">
            <button type="button" onClick={() => move(-1)} className="label text-ivory/70 hover:text-champagne">← {dict.gallery.prev}</button>
            <span className="label text-champagne">{String(open + 1).padStart(2, "0")} / {String(images.length).padStart(2, "0")}</span>
            <button type="button" onClick={() => move(1)} className="label text-ivory/70 hover:text-champagne">{dict.gallery.next} →</button>
          </div>
          <button
            type="button"
            onClick={() => setOpen(null)}
            className="label absolute right-6 top-6 text-ivory/70 hover:text-ivory"
          >
            {dict.gallery.close} ✕
          </button>
        </div>
      )}
    </>
  );
}

/** Horizontal scroll-snap track with a "3 / 8" counter and dots; native swipe, no library. */
function SwipeTrack({
  images, altOf, labelOf, onOpen,
}: {
  images: ListingImage[];
  altOf: (i: number) => string;
  labelOf: (i: number) => string;
  onOpen: (i: number) => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const onScroll = () => {
    const el = track.current;
    if (el) setIndex(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)));
  };
  return (
    <div className="relative lg:hidden">
      <div
        ref={track}
        onScroll={onScroll}
        className="flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {images.map((image, i) => (
          <button
            key={image.url}
            type="button"
            onClick={() => onOpen(i)}
            aria-label={labelOf(i)}
            className="relative aspect-[4/3] w-full shrink-0 snap-center overflow-hidden bg-ivory-3"
          >
            <Image
              src={image.url}
              alt={altOf(i)}
              fill
              sizes="100vw"
              priority={i === 0}
              loading={i === 0 ? undefined : "lazy"}
              className="object-cover"
            />
          </button>
        ))}
      </div>
      {images.length > 1 && (
        <>
          <span className="label pointer-events-none absolute right-3 top-3 rounded-full bg-ink/70 px-3 py-1 text-ivory">
            {index + 1} / {images.length}
          </span>
          <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center gap-1.5">
            {images.slice(0, 12).map((image, i) => (
              <span
                key={image.url}
                className={`h-1.5 rounded-full transition-all duration-300 ${i === index ? "w-5 bg-ivory" : "w-1.5 bg-ivory/55"}`}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Frame({
  image, alt, index, total, onOpen, label, className = "", sizes, priority = false, counter = false, overlay,
}: {
  image: ListingImage;
  alt: string;
  index: number;
  total: number;
  label: string;
  onOpen: (i: number) => void;
  className?: string;
  sizes: string;
  priority?: boolean;
  counter?: boolean;
  overlay?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(index)}
      className={`group relative block overflow-hidden bg-ivory-3 ${className}`}
      aria-label={label}
    >
      <Image
        src={image.url}
        alt={alt}
        fill
        sizes={sizes}
        priority={priority}
        loading={priority ? undefined : "lazy"}
        className="img-zoom object-cover"
      />
      {counter && (
        <span className="label absolute bottom-3 left-4 text-ivory/70 transition-opacity duration-500 group-hover:text-champagne">
          {String(index + 1).padStart(2, "0")}
        </span>
      )}
      {overlay && (
        <span className="absolute inset-0 flex items-center justify-center bg-ink/55 font-display text-[1.6rem] text-ivory">
          {overlay}
        </span>
      )}
    </button>
  );
}
