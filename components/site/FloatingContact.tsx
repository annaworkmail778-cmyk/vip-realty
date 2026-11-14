"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useSiteProfile } from "@/components/site/SiteProfileProvider";
import { useDict } from "@/components/site/LocaleProvider";
import { PhoneGlyph, ViberGlyph, WhatsAppGlyph } from "@/components/ui/ContactIcons";
import { fill } from "@/lib/i18n/fill";
import { telHref, viberUrl, whatsappUrl } from "@/lib/site/profile";

/* ----------------------------------------------------------------------------
   Phone-only floating contact: one gold button, bottom right, that opens call,
   WhatsApp and Viber. It appears once the visitor has scrolled past the first
   screen and is absent on a property page, which has its own sticky bar.
   Each action exists only when the agency profile has that detail; with none,
   nothing is rendered.
---------------------------------------------------------------------------- */

export function FloatingContact() {
  const profile = useSiteProfile();
  const dict = useDict();
  const pathname = usePathname();
  const [shown, setShown] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setShown(window.scrollY > window.innerHeight * 0.6);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const tel = telHref(profile);
  const whatsapp = whatsappUrl(profile, fill(dict.contact.whatsappGeneral, { brand: profile.brandName }));
  const viber = viberUrl(profile);
  const onPropertyPage = /^\/properties\/[^/]+$/.test(pathname);
  if (onPropertyPage || (!tel && !whatsapp)) return null;

  /* Labelled pills, not bare icons: the WhatsApp and Viber marks are easy to
     confuse at this size, and a word removes any doubt. */
  const item =
    "flex h-12 items-center gap-3 rounded-full bg-ink/95 pl-5 pr-4 text-ivory shadow-lg ring-1 ring-champagne/40 transition-transform duration-300 active:scale-95";
  const icon = "flex h-8 w-8 items-center justify-center rounded-full bg-champagne/15 text-champagne";

  return (
    <div
      className={`fixed bottom-5 right-5 z-[85] flex flex-col items-end gap-3 transition-all duration-500 lg:hidden ${
        shown ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-6 opacity-0"
      }`}
      style={{ marginBottom: "env(safe-area-inset-bottom)" }}
    >
      {open && (
        <div className="flex flex-col items-end gap-3 [animation:fade_0.3s_var(--ease-editorial)_both]">
          {whatsapp && (
            <a href={whatsapp} target="_blank" rel="noreferrer" className={item}>
              <span className="label">WhatsApp</span>
              <span className={icon}><WhatsAppGlyph size={18} /></span>
            </a>
          )}
          {viber && (
            <a href={viber} className={item}>
              <span className="label">Viber</span>
              <span className={icon}><ViberGlyph size={18} /></span>
            </a>
          )}
          {tel && (
            <a href={tel} aria-label={`${dict.contact.call} ${profile.brandName}`} className={item}>
              <span className="label">{dict.contact.call}</span>
              <span className={icon}><PhoneGlyph size={16} /></span>
            </a>
          )}
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={open ? dict.nav.close : dict.contact.contactUs}
        className="flex h-14 w-14 items-center justify-center rounded-full bg-champagne text-black shadow-xl transition-transform duration-300 active:scale-95"
      >
        {open ? <span className="text-xl leading-none" aria-hidden>✕</span> : <PhoneGlyph size={22} />}
      </button>
    </div>
  );
}
