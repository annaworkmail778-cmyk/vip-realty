"use client";

import { useCallback, useState } from "react";
import { InquiryDialog, type InquiryListing } from "./InquiryDialog";
import { useDict } from "@/components/site/LocaleProvider";

/* The "Request more information" call to action and the panel it opens. */
export function InquiryButton({
  listing, variant = "primary", className = "",
}: {
  listing: InquiryListing;
  /** "ink" is the light inventory surface variant; the others are for dark sections. */
  variant?: "primary" | "outline" | "ink";
  className?: string;
}) {
  const dict = useDict();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  const base =
    "label-lg group flex w-full items-center justify-center gap-3 px-6 py-4 transition-colors duration-500";
  const tone =
    variant === "primary"
      ? "bg-champagne text-black hover:bg-ivory"
      : variant === "ink"
        ? "bg-ink text-parchment hover:bg-espresso"
        : "border border-ivory/30 text-ivory hover:border-champagne hover:text-champagne";

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={`${base} ${tone} ${className}`}>
        {dict.contact.requestInfo}
        <span className="arrow-slide" aria-hidden>→</span>
      </button>
      <InquiryDialog listing={listing} open={open} onClose={close} />
    </>
  );
}
