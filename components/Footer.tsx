import Link from "next/link";
import { Logo } from "@/components/ui/Logo";
import { site } from "@/lib/site";
import { getSiteProfile } from "@/lib/site/profile.server";
import { getDictionary } from "@/lib/i18n/get-dictionary";
import { fill } from "@/lib/i18n/fill";
import { telHref, whatsappUrl } from "@/lib/site/profile";
import { MEDIA_IS_PLACEHOLDER } from "@/lib/media";
import { CATEGORIES } from "@/lib/listings/taxonomy";
import { ArrowLink } from "@/components/ui/ArrowLink";
import type { DistrictOption } from "@/lib/listings/types";

/* `districts` are the neighbourhoods that currently have published listings. */
export async function Footer({ districts }: { districts: DistrictOption[] }) {
  const year = new Date().getFullYear();
  const [profile, { dict }] = await Promise.all([getSiteProfile(), getDictionary()]);
  const socialLinks = site.social.flatMap((s) => (s.href ? [{ label: s.label, href: s.href }] : []));
  const tel = telHref(profile);
  const whatsapp = whatsappUrl(
    profile,
    fill(dict.contact.whatsappGeneral, { brand: profile.brandName }),
  );

  return (
    <footer data-nav-tone="dark" className="border-t border-ivory/10 bg-ink text-ivory">
      {(tel || whatsapp) && (
        <div className="shell border-b border-ivory/10 py-12 lg:py-14">
          <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="label text-ivory/45">{dict.contact.speakToUs}</p>
              {tel && (
                <a
                  href={tel}
                  className="mt-4 block font-display text-[clamp(1.9rem,4.5vw,3rem)] leading-none text-ivory transition-colors duration-500 hover:text-champagne"
                >
                  {profile.phone}
                </a>
              )}
              {profile.officeHours && <p className="label mt-4 text-ivory/50">{profile.officeHours}</p>}
            </div>
            <div className="flex flex-wrap items-center gap-8">
              {whatsapp && (
                <ArrowLink href={whatsapp} tone="gold" external>{dict.contact.whatsapp}</ArrowLink>
              )}
              <ArrowLink href="/#contact">{dict.contact.tellUs}</ArrowLink>
            </div>
          </div>
        </div>
      )}

      <div className="shell py-16 lg:py-20">
        <div className="grid gap-12 lg:grid-cols-[1.2fr_1fr_1fr_1fr]">
          <div>
            <Logo />
            <p className="measure mt-6 text-sm font-light leading-relaxed text-ivory/55">
              {fill(dict.footer.blurb, { concept: dict.brand.concept, cityIn: dict.brand.cityIn, cityOf: dict.brand.cityOf })}
            </p>
            {profile.legalName !== profile.brandName && (
              <p className="label mt-6 text-ivory/40">{profile.legalName}</p>
            )}
          </div>

          <nav aria-label={dict.footer.properties}>
            <p className="label text-ivory/45">{dict.footer.properties}</p>
            <ul className="mt-5 space-y-2.5">
              {CATEGORIES.map((c) => (
                <li key={c.id}>
                  <Link href={`/properties?type=${c.id}`} className="label link-underline text-ivory/75 hover:text-ivory">
                    {dict.taxonomy.categories[c.id]}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <nav aria-label={dict.footer.neighbourhoods}>
            <p className="label text-ivory/45">{dict.footer.neighbourhoods}</p>
            <ul className="mt-5 space-y-2.5">
              {districts.map((d) => (
                <li key={d.id}>
                  <Link href={`/properties?district=${d.id}`} className="label link-underline text-ivory/75 hover:text-ivory">
                    {d.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <div id="footer-contact">
            <p className="label text-ivory/45">{dict.footer.contact}</p>
            <ul className="mt-5 space-y-2.5 label text-ivory/75">
              {tel && <li><a href={tel} className="link-underline">{profile.phone}</a></li>}
              {profile.email && (
                <li><a href={`mailto:${profile.email}`} className="link-underline">{profile.email}</a></li>
              )}
              {profile.officeAddress && <li className="text-ivory/55">{profile.officeAddress}</li>}
              {profile.officeHours && <li className="text-ivory/55">{profile.officeHours}</li>}
              {!profile.configured && <li className="text-ivory/55">{dict.footer.beingSetUp}</li>}
            </ul>
            {socialLinks.length > 0 && (
              <ul className="mt-6 flex gap-5">
                {socialLinks.map((s) => (
                  <li key={s.label}>
                    <a href={s.href} rel="noopener noreferrer" target="_blank"
                       className="label link-underline text-ivory/60 hover:text-ivory">{s.label}</a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="mt-14 flex flex-col gap-4 border-t border-ivory/10 pt-7 sm:flex-row sm:items-center sm:justify-between">
          <p className="label text-ivory/35">© {year} {profile.legalName}</p>
          <p className="label text-ivory/35">
            {MEDIA_IS_PLACEHOLDER
              ? dict.footer.placeholderMedia
              : `${dict.brand.city}, ${dict.brand.country}`}
          </p>
        </div>
      </div>
    </footer>
  );
}
