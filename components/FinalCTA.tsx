import { CtaBackdrop } from "@/components/CtaBackdrop";
import { ButtonLink } from "@/components/ui/ArrowLink";
import { PhoneGlyph, ViberGlyph, WhatsAppGlyph } from "@/components/ui/ContactIcons";
import { getDictionary } from "@/lib/i18n/get-dictionary";
import { fill } from "@/lib/i18n/fill";
import { formatPhone, mapsUrl, telLink, viberUrl, whatsappUrl, type SiteProfile } from "@/lib/site/profile";

/* ----------------------------------------------------------------------------
   09 — Closing, and the page's #contact anchor. One sentence, then the ways to
   reach the agency directly: call (each public number), WhatsApp, Viber, and
   the office on the map. Every action appears only when the agency profile has
   that detail; with none configured the section keeps its two links.
---------------------------------------------------------------------------- */

export async function FinalCTA({ profile }: { profile: SiteProfile }) {
  const { dict } = await getDictionary();
  const phones = [profile.phone, profile.phoneSecondary].filter((p): p is string => Boolean(p));
  const whatsapp = whatsappUrl(profile, fill(dict.contact.whatsappGeneral, { brand: profile.brandName }));
  const viber = viberUrl(profile);
  const map = mapsUrl(profile);
  const hasDirect = phones.length > 0 || whatsapp !== null;

  const action =
    "label-lg flex items-center justify-center gap-3 border border-ivory/25 px-6 py-4 text-ivory transition-colors duration-500 hover:border-champagne hover:text-champagne";

  return (
    <section
      id="contact"
      data-nav-tone="dark"
      className="relative flex min-h-[86svh] items-center justify-center overflow-hidden bg-black text-center text-ivory"
    >
      <CtaBackdrop />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/55 via-black/25 to-black/70" aria-hidden />

      <div className="shell relative py-[var(--spacing-section)]">
        <p data-reveal="fade" className="label text-champagne">{dict.cta.eyebrow}</p>

        <h2 data-reveal="up" className="display-lg mx-auto mt-8 max-w-[16ch]">{dict.cta.title}</h2>

        {hasDirect ? (
          <div data-reveal="up" className="mx-auto mt-12 grid max-w-3xl gap-3 sm:grid-cols-2">
            {phones.map((phone) => (
              <a key={phone} href={telLink(phone)!} className={`${action} bg-champagne !border-champagne text-black hover:!text-black hover:bg-ivory`}>
                <PhoneGlyph />
                {formatPhone(phone)}
              </a>
            ))}
            {whatsapp && (
              <a href={whatsapp} target="_blank" rel="noreferrer" className={action}>
                <WhatsAppGlyph />
                {dict.contact.whatsapp}
              </a>
            )}
            {viber && (
              <a href={viber} className={action}>
                <ViberGlyph />
                {dict.contact.viber}
              </a>
            )}
          </div>
        ) : (
          <div data-reveal="up" className="mt-12 flex flex-wrap items-center justify-center gap-3 sm:gap-4">
            <ButtonLink href="/properties">{dict.hero.explore}</ButtonLink>
            <ButtonLink href="/#footer-contact" variant="outline">
              {fill(dict.contact.contactBrand, { brand: profile.brandName })}
            </ButtonLink>
          </div>
        )}

        {(profile.officeAddress || profile.officeHours) && (
          <div data-reveal="up" className="mt-10 space-y-2">
            {profile.officeAddress && (
              <p className="label text-ivory/75">
                {dict.contact.visitUs}: {profile.officeAddress}
                {map && (
                  <>
                    {" · "}
                    <a href={map} target="_blank" rel="noreferrer" className="link-underline text-champagne">
                      {dict.contact.openMap}
                    </a>
                  </>
                )}
              </p>
            )}
            {profile.officeHours && <p className="label text-ivory/50">{profile.officeHours}</p>}
          </div>
        )}
      </div>
    </section>
  );
}
