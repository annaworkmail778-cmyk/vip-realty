"use client";

import { useState } from "react";
import { InquiryDialog, type InquiryListing } from "./InquiryDialog";
import { useSiteProfile } from "@/components/site/SiteProfileProvider";
import { useDict } from "@/components/site/LocaleProvider";
import { fill } from "@/lib/i18n/fill";
import { telHref, viberUrl, whatsappUrl } from "@/lib/site/profile";
import { PhoneGlyph, ViberGlyph, WhatsAppGlyph } from "@/components/ui/ContactIcons";

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
  const viber = viberUrl(profile);

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
            {viber && (
              <a
                href={viber}
                aria-label={dict.contact.viber}
                className="flex h-11 w-11 items-center justify-center border border-espresso/20 text-espresso transition-colors duration-500 hover:border-gold hover:text-gold"
              >
                <ViberGlyph />
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


