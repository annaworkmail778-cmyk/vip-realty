import { getDictionary } from "@/lib/i18n/get-dictionary";
import { fill } from "@/lib/i18n/fill";
import { telLink, whatsappUrl, type SiteProfile } from "@/lib/site/profile";
import { PhoneGlyph, WhatsAppGlyph } from "@/components/ui/ContactIcons";

/* ----------------------------------------------------------------------------
   What the agency does for a visitor — sell or let, buy, rent — each with a
   direct way to start. Replaces the scroll-driven "empty room to furnished
   room" film, which visitors did not connect with the agency's services.
---------------------------------------------------------------------------- */

export async function ServicesSection({ profile }: { profile: SiteProfile }) {
  const { dict } = await getDictionary();
  const s = dict.services;
  const tel = telLink(profile.phone);
  const whatsapp = whatsappUrl(profile, fill(dict.lead.whatsapp, { brand: profile.brandName }));

  return (
    <section data-nav-tone="dark" className="bg-black py-[var(--spacing-section)] text-ivory">
      <div className="shell">
        <p data-reveal="fade" className="label text-champagne">{s.label}</p>
        <h2 data-reveal="up" className="display-md mt-4 max-w-[20ch]">{s.title}</h2>

        <ul className="mt-12 grid gap-px overflow-hidden border border-ivory/12 bg-ivory/12 md:grid-cols-3">
          {s.items.map((item) => (
            <li key={item.title} data-reveal="up" className="bg-black p-7 sm:p-9">
              <h3 className="font-display text-[1.5rem] leading-tight text-ivory">{item.title}</h3>
              <p className="mt-4 text-[0.95rem] font-light leading-relaxed text-ivory/70">{item.text}</p>
            </li>
          ))}
        </ul>

        {(tel || whatsapp) && (
          <div className="mt-10 flex flex-col gap-3 sm:flex-row">
            {tel && (
              <a href={tel} className="label-lg flex items-center justify-center gap-3 bg-ivory px-7 py-4 text-ink transition-colors duration-500 hover:bg-champagne">
                <PhoneGlyph /> {dict.lead.call}
              </a>
            )}
            {whatsapp && (
              <a href={whatsapp} target="_blank" rel="noreferrer" className="label-lg flex items-center justify-center gap-3 border border-ivory/25 px-7 py-4 text-ivory transition-colors duration-500 hover:border-champagne hover:text-champagne">
                <WhatsAppGlyph /> {dict.lead.write}
              </a>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
