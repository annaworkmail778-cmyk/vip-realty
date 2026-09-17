"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";

/* Elegant gallery: an editorial strip that opens into a full-bleed lightbox. */
export function PropertyGallery({ images, name }: { images: string[]; name: string }) {
  const [open, setOpen] = useState<number | null>(null);

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

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        {images.map((src, i) => (
          <button
            key={src}
            type="button"
            onClick={() => setOpen(i)}
            className={`group relative block overflow-hidden bg-black ${
              i === 0 ? "aspect-[16/10] sm:col-span-2" : "aspect-[4/3]"
            }`}
            aria-label={`Open image ${i + 1} of ${images.length}`}
          >
            <Image
              src={src}
              alt={`${name}, image ${i + 1}`}
              fill
              sizes="(max-width: 640px) 100vw, 46vw"
              loading="lazy"
              className="img-zoom object-cover"
            />
            <span className="label absolute bottom-3 left-4 text-ivory/70 transition-opacity duration-500 group-hover:text-champagne">
              {String(i + 1).padStart(2, "0")}
            </span>
          </button>
        ))}
      </div>

      {open !== null && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`${name} gallery`}
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/95 p-4"
        >
          <button
            type="button"
            onClick={() => setOpen(null)}
            aria-label="Close gallery"
            className="absolute inset-0 h-full w-full cursor-default"
          />
          <div className="relative h-[76vh] w-full max-w-6xl">
            <Image
              src={images[open]}
              alt={`${name}, image ${open + 1}`}
              fill
              sizes="90vw"
              className="object-contain"
              priority
            />
          </div>
          <div className="absolute inset-x-0 bottom-6 flex items-center justify-center gap-10">
            <button type="button" onClick={() => move(-1)} className="label text-ivory/70 hover:text-champagne">← Prev</button>
            <span className="label text-champagne">{String(open + 1).padStart(2, "0")} / {String(images.length).padStart(2, "0")}</span>
            <button type="button" onClick={() => move(1)} className="label text-ivory/70 hover:text-champagne">Next →</button>
          </div>
          <button
            type="button"
            onClick={() => setOpen(null)}
            className="label absolute right-6 top-6 text-ivory/70 hover:text-ivory"
          >
            Close ✕
          </button>
        </div>
      )}
    </>
  );
}
