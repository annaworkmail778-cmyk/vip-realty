"use client";

import { useState } from "react";
import { InquiryDialog, type InquiryListing } from "./InquiryDialog";
import { useSiteProfile } from "@/components/site/SiteProfileProvider";
import { useDict } from "@/components/site/LocaleProvider";
import { fill } from "@/lib/i18n/fill";
import { telHref, whatsappUrl } from "@/lib/site/profile";

/* ----------------------------------------------------------------------------
   Mobile sticky contact bar for a property page.

   A phone is where most enquiries start, and on a long property page the contact
   action otherwise scrolls out of reach. The bar carries the price as context and
   one primary action; the call and WhatsApp affordances appear only when the
   configured agency actually has those details, so nothing is invented.

   Desktop keeps the sticky sidebar panel instead — this is hidden from `lg` up.
   The footer reserves matching space via the `body:has([data-sticky-cta]) footer`
   rule in globals.css (the footer is rendered outside this page, so the page
   cannot reserve it itself), and the bar respects the iOS safe area.
---------------------------------------------------------------------------- */
export function StickyContactBar({
  listing,
  price,
}: {
  listing: InquiryListing;
  price: string;
}) {
  const [open, setOpen] = useState(false);
  const profile = useSiteProfile();
  const dict = useDict();
  const enquiry = fill(dict.contact.whatsappListing, {
    brand: profile.brandName,
    name: listing.name,
    place: listing.location,
    price,
    slug: listing.slug,
  });
  const tel = telHref(profile);
  const whatsapp = whatsappUrl(profile, enquiry);

  return (
    <>
      <div
        data-sticky-cta
        className="fixed inset-x-0 bottom-0 z-[80] border-t border-espresso/12 bg-parchment/95 backdrop-blur-md lg:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="flex items-center gap-4 px-[clamp(1.25rem,5vw,2rem)] py-3">
          <div className="min-w-0 flex-1">
            <p className="label text-espresso/50">{dict.contact.price}</p>
            <p className="price mt-1 truncate text-ink">{price}</p>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {whatsapp && (
              <a
                href={whatsapp}
                target="_blank"
                rel="noreferrer"
                aria-label={dict.contact.whatsapp}
                className="flex h-11 w-11 items-center justify-center border border-espresso/20 text-espresso transition-colors duration-500 hover:border-gold hover:text-gold"
              >
                <WhatsAppGlyph />
              </a>
            )}
            {tel && (
              <a
                href={tel}
                aria-label={`${dict.contact.call} ${profile.brandName}`}
                className="flex h-11 w-11 items-center justify-center border border-espresso/20 text-espresso transition-colors duration-500 hover:border-gold hover:text-gold"
              >
                <PhoneGlyph />
              </a>
            )}
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="label-lg flex h-11 items-center bg-ink px-5 text-parchment transition-colors duration-500 hover:bg-espresso"
            >
              {dict.contact.enquire}
            </button>
          </div>
        </div>
      </div>

      <InquiryDialog listing={listing} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function WhatsAppGlyph() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2Zm0 18.02h-.01a8.2 8.2 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.22 8.22 0 0 1-1.26-4.39c0-4.54 3.7-8.23 8.25-8.23a8.2 8.2 0 0 1 8.24 8.24c0 4.54-3.7 8.24-8.24 8.24Zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.24-.64.8-.78.97-.15.16-.29.18-.54.06-.25-.13-1.05-.39-1.99-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.01-.38.11-.5.11-.11.25-.29.37-.44.13-.15.17-.25.25-.41.09-.17.04-.31-.02-.44-.06-.12-.56-1.34-.76-1.84-.2-.48-.4-.42-.56-.42l-.47-.01c-.17 0-.44.06-.67.31-.23.25-.87.85-.87 2.07s.9 2.4 1.02 2.56c.12.17 1.75 2.67 4.25 3.74.59.26 1.06.41 1.42.52.6.19 1.14.16 1.57.1.48-.07 1.47-.6 1.68-1.18.21-.58.21-1.07.15-1.18-.06-.11-.23-.17-.48-.29Z" />
    </svg>
  );
}

function PhoneGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <path
        d="M6.5 3h-2A1.5 1.5 0 0 0 3 4.6c.2 3.3 1.5 6.4 3.6 8.9 2 2.4 4.7 4 7.7 4.6a1.5 1.5 0 0 0 1.7-1.5v-2c0-.7-.5-1.3-1.2-1.5l-2-.4c-.5-.1-1 .1-1.3.5l-.6.8a12 12 0 0 1-4-4l.8-.6c.4-.3.6-.8.5-1.3l-.4-2C7.8 3.5 7.2 3 6.5 3Z"
        strokeLinejoin="round"
      />
    </svg>
  );
}
