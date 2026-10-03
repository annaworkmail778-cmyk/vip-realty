"use client";

import { InquiryButton } from "@/components/inquiry/InquiryButton";
import type { InquiryListing } from "@/components/inquiry/InquiryDialog";
import { useSiteProfile } from "@/components/site/SiteProfileProvider";
import { useDict, useFormat } from "@/components/site/LocaleProvider";
import { fill } from "@/lib/i18n/fill";
import { telHref, whatsappUrl } from "@/lib/site/profile";
import type { Listing } from "@/lib/listings/types";

/* ----------------------------------------------------------------------------
   Sticky contact panel: request information, agent, call and WhatsApp.

   Contact details come from the configured agency (lib/site/profile.ts); each
   action is shown only when that detail exists. The WhatsApp message is
   prefilled with the listing title and its public reference (slug) only —
   nothing internal.

   `tone` follows the house convention (see ArrowLink, SectionLabel,
   PropertyFilters): "light" for the ivory inventory surfaces, "dark" for the
   cinematic brand sections.
---------------------------------------------------------------------------- */

export function ContactPanel({
  listing,
  inquiry,
  tone = "dark",
}: {
  listing: Listing;
  inquiry: InquiryListing;
  tone?: "dark" | "light";
}) {
  const profile = useSiteProfile();
  const dict = useDict();
  const fmt = useFormat();
  /* The listing's display title, place and price as the visitor sees them on
     the page; the slug stays the stable reference the agency can look up. The
     place has its own slot in the message, so a generated title omits it. */
  const enquiry = fill(dict.contact.whatsappListing, {
    brand: profile.brandName,
    name: fmt.title(listing, { short: true }),
    place: listing.districtLabel ? fmt.districtName(listing.districtLabel) : fmt.cityName(listing.city),
    price: fmt.price(listing),
    slug: listing.slug,
  });
  const tel = telHref(profile);
  const whatsapp = whatsappUrl(profile, enquiry);
  const light = tone === "light";

  const t = {
    shell: light ? "card p-7" : "border border-ivory/12 bg-espresso/30 p-7",
    muted: light ? "text-espresso/50" : "text-ivory/40",
    faint: light ? "text-espresso/45" : "text-ivory/35",
    price: light ? "text-ink" : "text-champagne",
    name: light ? "text-ink" : "text-ivory",
    hours: light ? "text-cocoa" : "text-ivory/50",
    link: light ? "text-espresso/80 hover:text-ink" : "text-ivory/80 hover:text-ivory",
    divider: light ? "border-espresso/12" : "border-ivory/12",
    whatsapp: light
      ? "bg-ink text-parchment hover:bg-espresso"
      : "bg-ivory text-ink hover:bg-champagne",
  };

  return (
    <aside className="lg:sticky lg:top-[calc(var(--nav-h)+1.5rem)]">
      <div className={t.shell}>
        <p className={`label ${t.muted}`}>{dict.contact.price}</p>
        <p className={`price price-lg mt-2 ${t.price}`}>{fmt.price(listing)}</p>

        <div className="mt-6">
          <InquiryButton listing={inquiry} variant={light ? "ink" : "primary"} />
          <p className={`label mt-3 ${t.faint}`}>{dict.contact.leaveDetails}</p>
        </div>

        <div className={`mt-7 border-t pt-6 ${t.divider}`}>
          <p className={`label ${t.muted}`}>{dict.contact.contact}</p>
          <p className={`mt-3 font-display text-[1.35rem] leading-tight ${t.name}`}>{profile.legalName}</p>
          {profile.officeHours && <p className={`label mt-2 ${t.hours}`}>{profile.officeHours}</p>}

          <div className="mt-5 space-y-2.5">
            {tel && (
              <a href={tel} className={`label link-underline block ${t.link}`}>{profile.phone}</a>
            )}
            {profile.email && (
              <a href={`mailto:${profile.email}`} className={`label link-underline block ${t.link}`}>
                {profile.email}
              </a>
            )}
          </div>

          {whatsapp && (
            <a
              href={whatsapp}
              target="_blank"
              rel="noreferrer"
              className={`label-lg mt-6 flex w-full items-center justify-center gap-3 px-6 py-4 transition-colors duration-500 ${t.whatsapp}`}
            >
              <WhatsAppIcon />
              {dict.contact.whatsapp}
            </a>
          )}
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
