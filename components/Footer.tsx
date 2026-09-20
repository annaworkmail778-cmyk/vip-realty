import Link from "next/link";
import { Logo } from "@/components/ui/Logo";
import { site } from "@/lib/site";
import { getSiteProfile } from "@/lib/site/profile.server";
import { telHref } from "@/lib/site/profile";
import { MEDIA_IS_PLACEHOLDER } from "@/lib/media";
import { CATEGORIES } from "@/lib/listings/taxonomy";
import type { DistrictOption } from "@/lib/listings/types";

/* `districts` are the neighbourhoods that currently have published listings. */
export async function Footer({ districts }: { districts: DistrictOption[] }) {
  const year = new Date().getFullYear();
  const profile = await getSiteProfile();
  const tel = telHref(profile);

  return (
    <footer data-nav-tone="dark" className="border-t border-ivory/10 bg-ink text-ivory">
      <div className="shell py-16 lg:py-20">
        <div className="grid gap-12 lg:grid-cols-[1.2fr_1fr_1fr_1fr]">
          <div>
            <Logo />
            <p className="measure mt-6 text-sm font-light leading-relaxed text-ivory/55">
              {site.concept}. Properties in {site.city} selected for the way you want to live.
            </p>
          </div>

          <nav aria-label="Properties">
            <p className="label text-ivory/35">Properties</p>
            <ul className="mt-5 space-y-2.5">
              {CATEGORIES.map((c) => (
                <li key={c.id}>
                  <Link href={`/properties?type=${c.id}`} className="label link-underline text-ivory/75 hover:text-ivory">
                    {c.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <nav aria-label="Neighbourhoods">
            <p className="label text-ivory/35">Neighbourhoods</p>
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
            <p className="label text-ivory/35">Contact</p>
            <ul className="mt-5 space-y-2.5 label text-ivory/75">
              {tel && <li><a href={tel} className="link-underline">{profile.phone}</a></li>}
              {profile.email && (
                <li><a href={`mailto:${profile.email}`} className="link-underline">{profile.email}</a></li>
              )}
              {profile.officeAddress && <li className="text-ivory/55">{profile.officeAddress}</li>}
              {profile.officeHours && <li className="text-ivory/55">{profile.officeHours}</li>}
              {!profile.configured && <li className="text-ivory/55">Contact details are being set up.</li>}
            </ul>
            <ul className="mt-6 flex gap-5">
              {site.social.map((s) => (
                <li key={s.label}>
                  <a href={s.href} className="label link-underline text-ivory/60 hover:text-ivory">{s.label}</a>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-14 flex flex-col gap-4 border-t border-ivory/10 pt-7 sm:flex-row sm:items-center sm:justify-between">
          <p className="label text-ivory/35">© {year} {profile.legalName}</p>
          <p className="label text-ivory/35">
            {MEDIA_IS_PLACEHOLDER
              ? "Placeholder imagery, contact details and statistics"
              : `${site.city}, ${site.country}`}
          </p>
        </div>
      </div>
    </footer>
  );
}
