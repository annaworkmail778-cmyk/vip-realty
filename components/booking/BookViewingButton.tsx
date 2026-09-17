"use client";

import { useState } from "react";
import { BookingPanel } from "./BookingPanel";
import type { Property } from "@/lib/properties";

/* The CTA and the panel it owns. Dropping this into any property surface is
   all it takes to make that property bookable — the property is passed in, so
   the booking is always tied to the right listing. */

export function BookViewingButton({
  property, variant = "primary", className = "",
}: {
  property: Property;
  variant?: "primary" | "outline";
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  const base =
    "label-lg group flex w-full items-center justify-center gap-3 px-6 py-4 transition-colors duration-500";
  const tone =
    variant === "primary"
      ? "bg-champagne text-black hover:bg-ivory"
      : "border border-ivory/30 text-ivory hover:border-champagne hover:text-champagne";

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={`${base} ${tone} ${className}`}>
        Book a viewing
        <span className="arrow-slide" aria-hidden>→</span>
      </button>
      <BookingPanel property={property} open={open} onClose={() => setOpen(false)} />
    </>
  );
}
