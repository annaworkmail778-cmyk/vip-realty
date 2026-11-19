"use client";

import { InquiryButton } from "@/components/inquiry/InquiryButton";
import type { InquiryListing } from "@/components/inquiry/InquiryDialog";
import { useSiteProfile } from "@/components/site/SiteProfileProvider";
import { useDict, useFormat } from "@/components/site/LocaleProvider";
import { fill } from "@/lib/i18n/fill";
import { formatPhone, listingContact, telHref, telLink, viberUrl, whatsappUrl } from "@/lib/site/profile";
import { PhoneGlyph, ViberGlyph, WhatsAppGlyph } from "@/components/ui/ContactIcons";
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
  className = "",
}: {
  listing: Listing;
  inquiry: InquiryListing;
  tone?: "dark" | "light";
  className?: string;
}) {
  const agency = useSiteProfile();
  /* The agent who brought the listing answers for it; the agency otherwise. */
  const profile = listingContact(agency, listing.agent);
  const agentName = listing.agent ? listing.agent.name : null;
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

  const hasAgent = Boolean(agentName && listing.agent && (listing.agent.phone || listing.agent.whatsapp));
  /* The agency line is offered as a fallback only when the agent's own number is shown above it. */
  const agencyTel = hasAgent ? telHref(agency) : null;
  const btn = "label-lg flex w-full items-center justify-center gap-3 px-6 py-4 transition-colors duration-500";
  const outline = light
    ? "border border-espresso/20 text-espresso hover:border-gold hover:text-gold"
    : "border border-ivory/25 text-ivory hover:border-champagne hover:text-champagne";

  return (
    <aside className={`lg:sticky lg:top-[calc(var(--nav-h)+1.5rem)] ${className}`}>
      <div className={t.shell}>
        {/* The page header already shows the price on a phone. */}
        <div className="hidden lg:block">
          <p className={`label ${t.muted}`}>{dict.contact.price}</p>
          <p className={`price price-lg mt-2 ${t.price}`}>{fmt.price(listing)}</p>
        </div>

        <div className={`lg:mt-7 lg:border-t lg:pt-6 ${t.divider}`}>
          <p className={`label ${t.muted}`}>{agentName ? dict.contact.agent : dict.contact.contact}</p>
          <p className={`mt-2 font-display text-[1.45rem] leading-tight ${t.name}`}>{agentName ?? profile.legalName}</p>
          {agentName && <p className={`label mt-1.5 ${t.hours}`}>{profile.legalName}</p>}

          {tel && (
            <a href={tel} className={`mt-4 block font-display text-[1.6rem] leading-none tracking-wide ${t.name}`}>
              {formatPhone(profile.phone!)}
            </a>
          )}

          <div className="mt-5 flex flex-col gap-3">
            {tel && (
              <a href={tel} className={`${btn} ${t.whatsapp}`}>
                <PhoneGlyph size={16} />
                {agentName ? dict.contact.callAgent : dict.contact.call}
              </a>
            )}
            {whatsapp && (
              <a href={whatsapp} target="_blank" rel="noreferrer" className={`${btn} ${outline}`}>
                <WhatsAppGlyph size={15} />
                {dict.contact.whatsapp}
              </a>
            )}
            {viber && (
              <a href={viber} className={`${btn} ${outline}`}>
                <ViberGlyph size={15} />
                {dict.contact.viber}
              </a>
            )}
          </div>

          {!hasAgent && (secondTel || profile.officeHours) && (
            <div className="mt-4 flex flex-col gap-1.5">
              {secondTel && (
                <a href={secondTel} className={`label link-underline self-start ${t.link}`}>{formatPhone(profile.phoneSecondary!)}</a>
              )}
              {profile.officeHours && <p className={`label ${t.hours}`}>{profile.officeHours}</p>}
            </div>
          )}

          {agencyTel && (
            <div className={`mt-6 border-t pt-5 ${t.divider}`}>
              <p className={`label ${t.muted}`}>{dict.contact.noAnswer}</p>
              <a href={agencyTel} className={`${btn} mt-3 ${outline}`}>
                <PhoneGlyph size={15} />
                <span>{dict.contact.callAgency}</span>
              </a>
              <p className={`label mt-2 text-center ${t.hours}`}>
                {agency.brandName} · {formatPhone(agency.phone!)}
                {agency.officeHours ? ` · ${agency.officeHours}` : ""}
              </p>
            </div>
          )}
        </div>

        <div className={`mt-7 border-t pt-6 ${t.divider}`}>
          <InquiryButton listing={inquiry} variant={light ? "ink" : "primary"} />
          <p className={`label mt-3 ${t.faint}`}>{dict.contact.leaveDetails}</p>
        </div>
      </div>
    </aside>
  );
}
