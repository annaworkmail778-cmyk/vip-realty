import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PropertyDetail } from "@/components/PropertyDetail";
import { formatPrice, locationLine } from "@/lib/listings/format";
import { legacyBookingProperty } from "@/lib/listings/legacy-booking";
import { getPublishedListing, listRelatedListings } from "@/lib/listings/queries";

/* ----------------------------------------------------------------------------
   Property detail, rendered per request from Supabase.

   There is no generateStaticParams: listings are created by automation at any
   time, so a slug must resolve without a rebuild. Only published listings are
   readable (RLS + the published view); drafts, unknown and malformed slugs all
   produce the standard not-found page. If Supabase cannot be reached, the
   error boundary shows a generic message — internal errors are never rendered.
---------------------------------------------------------------------------- */

type Params = { params: Promise<{ slug: string }> };

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

async function load(slug: string) {
  if (!SLUG.test(slug) || slug.length > 200) return null;
  const result = await getPublishedListing(slug);
  if (!result.ok) throw new Error("Listing is temporarily unavailable.");
  return result.data;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  let listing;
  try {
    listing = await load(slug);
  } catch {
    return { title: "Properties" };
  }
  if (!listing) return { title: "Property not found" };

  return {
    title: listing.name,
    description: `${listing.typeLabel} · ${locationLine(listing)}. ${formatPrice(listing)}.`,
    openGraph: listing.media.cover ? { images: [listing.media.cover.url] } : undefined,
  };
}

export default async function PropertyPage({ params }: Params) {
  const { slug } = await params;
  const listing = await load(slug);
  if (!listing) notFound();

  const related = await listRelatedListings(listing);

  return (
    <PropertyDetail
      listing={listing}
      related={related.ok ? related.data : []}
      bookable={legacyBookingProperty(listing.slug)}
    />
  );
}
