"use client";

import { BookViewingButton } from "@/components/booking/BookViewingButton";
import { site, WHATSAPP_URL } from "@/lib/site";
import { formatPrice, type Property } from "@/lib/properties";

/* ----------------------------------------------------------------------------
   Sticky contact panel: booking, agent, call and WhatsApp.

   Booking a viewing is the primary action and runs through the viewing system;
   WhatsApp and phone stay for everything a scheduled slot cannot answer.
---------------------------------------------------------------------------- */

export function ContactPanel({ property }: { property: Property }) {
  const enquiry = `Hello VIP Realty — I'd like to know more about ${property.name} (${property.districtLabel}), listed at ${formatPrice(property)}.`;

  return (
    <aside className="lg:sticky lg:top-[calc(var(--nav-h)+1.5rem)]">
      <div className="border border-ivory/12 bg-espresso/30 p-7">
        <p className="label text-ivory/40">Price</p>
        <p className="mt-2 font-display text-[2.1rem] leading-none text-champagne">{formatPrice(property)}</p>

        <div className="mt-6">
          <BookViewingButton property={property} />
          <p className="label mt-3 text-ivory/35">
            Choose a date and time. No account needed.
          </p>
        </div>

        <div className="mt-7 border-t border-ivory/12 pt-6">
          <p className="label text-ivory/40">Your agent</p>
          {/* PLACEHOLDER agent — replace with the real contact for this listing. */}
          <p className="mt-3 font-display text-[1.35rem] leading-tight text-ivory">VIP Realty Agency</p>
          <p className="label mt-2 text-ivory/50">{site.contact.hours}</p>

          <div className="mt-5 space-y-2.5">
            <a href={site.contact.phoneHref} className="label link-underline block text-ivory/80 hover:text-ivory">
              {site.contact.phone}
            </a>
            <a href={`mailto:${site.contact.email}`} className="label link-underline block text-ivory/80 hover:text-ivory">
              {site.contact.email}
            </a>
          </div>

          <a
            href={WHATSAPP_URL(enquiry)}
            target="_blank"
            rel="noreferrer"
            className="label-lg mt-6 flex w-full items-center justify-center gap-3 bg-ivory px-6 py-4 text-ink transition-colors duration-500 hover:bg-champagne"
          >
            <WhatsAppIcon />
            Message on WhatsApp
          </a>
        </div>

      </div>
    </aside>
  );
}

function WhatsAppIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2Zm0 18.02h-.01a8.2 8.2 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.22 8.22 0 0 1-1.26-4.39c0-4.54 3.7-8.23 8.25-8.23a8.2 8.2 0 0 1 8.24 8.24c0 4.54-3.7 8.24-8.24 8.24Zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.24-.64.8-.78.97-.15.16-.29.18-.54.06-.25-.13-1.05-.39-1.99-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.01-.38.11-.5.11-.11.25-.29.37-.44.13-.15.17-.25.25-.41.09-.17.04-.31-.02-.44-.06-.12-.56-1.34-.76-1.84-.2-.48-.4-.42-.56-.42l-.47-.01c-.17 0-.44.06-.67.31-.23.25-.87.85-.87 2.07s.9 2.4 1.02 2.56c.12.17 1.75 2.67 4.25 3.74.59.26 1.06.41 1.42.52.6.19 1.14.16 1.57.1.48-.07 1.47-.6 1.68-1.18.21-.58.21-1.07.15-1.18-.06-.11-.23-.17-.48-.29Z" />
    </svg>
  );
}
