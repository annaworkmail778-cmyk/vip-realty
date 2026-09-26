import { PropertyCard } from "@/components/PropertyCard";
import { SectionLabel } from "@/components/ui/SectionLabel";
import { ArrowLink } from "@/components/ui/ArrowLink";
import { getDictionary } from "@/lib/i18n/get-dictionary";
import type { Listing } from "@/lib/listings/types";

/* ----------------------------------------------------------------------------
   Latest properties — the first real inventory on the homepage.

   The brand sections that follow tell the story; this one answers the question a
   visitor actually arrives with. It sits on the ivory inventory surface so the
   transition out of the dark hero reads as deliberate, and it renders nothing at
   all when there are no published listings rather than showing an empty shell.
---------------------------------------------------------------------------- */
export async function LatestProperties({ listings }: { listings: Listing[] }) {
  if (listings.length === 0) return null;
  const { dict } = await getDictionary();

  return (
    <section
      data-nav-tone="light"
      className="bg-ivory py-[var(--spacing-inventory)] text-ink"
    >
      <div className="shell">
        <SectionLabel index="02" tone="ink">{dict.home.latestLabel}</SectionLabel>

        <div className="mt-6 flex flex-wrap items-end justify-between gap-6">
          <h2 data-reveal="up" className="display-md text-ink">{dict.home.latestTitle}</h2>
          <ArrowLink href="/properties" tone="ink">{dict.property.all}</ArrowLink>
        </div>

        <ul className="mt-10 grid gap-5 sm:grid-cols-2 sm:gap-6 xl:grid-cols-3">
          {listings.map((listing, i) => (
            <li key={listing.slug} className="flex">
              <PropertyCard listing={listing} priority={i < 3} />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
