"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useSiteProfile } from "@/components/site/SiteProfileProvider";
import { useDict } from "@/components/site/LocaleProvider";
import { PhoneGlyph, WhatsAppGlyph } from "@/components/ui/ContactIcons";
import { fill } from "@/lib/i18n/fill";
import { telHref, whatsappUrl } from "@/lib/site/profile";

/* ----------------------------------------------------------------------------
   A small card that slides in from the side a few seconds after arrival:
   "Selling or looking for a home? Write or call us." Shown on the home page and
   the listings index only (a property page has its own contact bar), at most
   once every three days per browser, and never when no contact detail exists.
---------------------------------------------------------------------------- */

const KEY = "vr_lead_prompt_seen";
const DELAY_MS = 7000;
const QUIET_DAYS = 3;

export function LeadPrompt() {
  const profile = useSiteProfile();
  const dict = useDict();
  const pathname = usePathname();
  const [shown, setShown] = useState(false);
  const eligible = pathname === "/" || pathname === "/properties";

  useEffect(() => {
    if (!eligible) return;
    let seen = 0;
    try { seen = Number(localStorage.getItem(KEY) ?? 0); } catch { /* storage blocked: show once per load */ }
    if (Date.now() - seen < QUIET_DAYS * 864e5) return;
    const timer = window.setTimeout(() => setShown(true), DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [eligible]);

  const close = () => {
    setShown(false);
    try { localStorage.setItem(KEY, String(Date.now())); } catch { /* ignore */ }
  };

  const tel = telHref(profile);
  const whatsapp = whatsappUrl(profile, fill(dict.lead.whatsapp, { brand: profile.brandName }));
  if (!eligible || (!tel && !whatsapp)) return null;

  return (
    <div
      role="dialog"
      aria-live="polite"
      aria-label={dict.lead.title}
      className={`fixed bottom-24 left-4 right-4 z-[90] transition-all duration-700 ease-out sm:left-auto sm:right-6 sm:w-[22rem] lg:bottom-8 ${
        shown ? "translate-x-0 opacity-100" : "pointer-events-none translate-x-[110%] opacity-0"
      }`}
      style={{ marginBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="relative border border-champagne/40 bg-ink p-6 text-ivory shadow-2xl">
        <button
          type="button"
          onClick={close}
          aria-label={dict.lead.close}
          className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center text-ivory/50 hover:text-ivory"
        >
          ✕
        </button>
        <p className="pr-8 font-display text-[1.35rem] leading-snug">{dict.lead.title}</p>
        <p className="mt-3 text-[0.9rem] font-light leading-relaxed text-ivory/70">{dict.lead.body}</p>
        <div className="mt-5 grid grid-cols-2 gap-2">
          {tel && (
            <a href={tel} onClick={close} className="label flex items-center justify-center gap-2 bg-champagne px-3 py-3 text-black">
              <PhoneGlyph size={14} /> {dict.lead.call}
            </a>
          )}
          {whatsapp && (
            <a href={whatsapp} target="_blank" rel="noreferrer" onClick={close}
               className={`label flex items-center justify-center gap-2 border border-ivory/25 px-3 py-3 text-ivory ${tel ? "" : "col-span-2"}`}>
              <WhatsAppGlyph size={14} /> WhatsApp
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
