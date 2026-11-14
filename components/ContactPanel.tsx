"use client";

import { InquiryButton } from "@/components/inquiry/InquiryButton";
import type { InquiryListing } from "@/components/inquiry/InquiryDialog";
import { useSiteProfile } from "@/components/site/SiteProfileProvider";
import { useDict, useFormat } from "@/components/site/LocaleProvider";
import { fill } from "@/lib/i18n/fill";
import { formatPhone, telHref, telLink, viberUrl, whatsappUrl } from "@/lib/site/profile";
import { ViberGlyph, WhatsAppGlyph } from "@/components/ui/ContactIcons";
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
  const viber = viberUrl(profile);
  const secondTel = telLink(profile.phoneSecondary);
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
              <a href={tel} className={`label link-underline block ${t.link}`}>{formatPhone(profile.phone!)}</a>
            )}
            {secondTel && (
              <a href={secondTel} className={`label link-underline block ${t.link}`}>{formatPhone(profile.phoneSecondary!)}</a>
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
              <WhatsAppGlyph size={15} />
              {dict.contact.whatsapp}
            </a>
          )}
          {viber && (
            <a
              href={viber}
              className={`label-lg mt-3 flex w-full items-center justify-center gap-3 border px-6 py-4 transition-colors duration-500 ${light ? "border-espresso/20 text-espresso hover:border-gold hover:text-gold" : "border-ivory/25 text-ivory hover:border-champagne hover:text-champagne"}`}
            >
              <ViberGlyph size={15} />
              {dict.contact.viber}
            </a>
          )}
        </div>

      </div>
    </aside>
  );
}

