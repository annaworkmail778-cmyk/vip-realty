import { Hero } from "@/components/Hero";
import { PropertySearch } from "@/components/PropertySearch";
import { NextAddress } from "@/components/NextAddress";
import { TransformationSection } from "@/components/TransformationSection";
import { PropertyCollection } from "@/components/PropertyCollection";
import { AboutSection } from "@/components/AboutSection";
import { PropertyMap } from "@/components/PropertyMap";
import { FeaturedProperty } from "@/components/FeaturedProperty";
import { getSiteProfile } from "@/lib/site/profile.server";
import { FinalCTA } from "@/components/FinalCTA";
import {
  getCategoryCounts,
  getFacetOptions,
  listFeaturedListings,
  listRecentListings,
} from "@/lib/listings/queries";

/** How many listings the map section shows; the index has the full set. */
const MAP_LIMIT = 100;
/** Length of the scrubbed "next address" sequence. */
const SEQUENCE_LENGTH = 6;

/* Rendered per request so newly published listings appear immediately. If
   Supabase is unavailable the listing sections show their empty states and the
   rest of the page is unaffected. */
export default async function HomePage() {
  const [recent, featured, counts, facets, profile] = await Promise.all([
    listRecentListings(MAP_LIMIT),
    listFeaturedListings(1),
    getCategoryCounts(),
    getFacetOptions(),
    getSiteProfile(),
  ]);

  const listings = recent.ok ? recent.data : [];
  const featuredListing = featured.ok ? featured.data[0] : undefined;

  return (
    <>
      <Hero />
      <PropertySearch districts={facets.districts} />
      <NextAddress listings={listings.slice(0, SEQUENCE_LENGTH)} />
      <TransformationSection />
      <PropertyCollection counts={counts.ok ? counts.data : null} />
      <AboutSection />
      <PropertyMap properties={listings} />
      {featuredListing && <FeaturedProperty listing={featuredListing} />}
      <FinalCTA brandName={profile.brandName} />
    </>
  );
}
