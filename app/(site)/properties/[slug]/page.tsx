import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PropertyDetail } from "@/components/PropertyDetail";
import { getPublishedListing, listRelatedListings } from "@/lib/listings/queries";
import { getDictionary } from "@/lib/i18n/get-dictionary";
import { canonical } from "@/lib/site/url";

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
  const { dict, fmt } = await getDictionary();
  let listing;
  try {
    listing = await load(slug);
  } catch {
    return { title: dict.page.indexMetaTitle };
  }
  if (!listing) return { title: dict.page.notFoundMetaTitle };

  // The display title: a system-generated one in the UI language, any other one
  // verbatim (fmt.title). Type, place and price follow the UI language.
  const title = fmt.title(listing);
  return {
    title,
    description: `${fmt.type(listing)} · ${fmt.locationLine(listing)}. ${fmt.price(listing)}.`,
    // Without a cover photo the site-wide Open Graph image (root layout) applies.
    openGraph: listing.media.cover
      ? { title, images: [{ url: listing.media.cover.url, alt: listing.media.cover.alt || title }] }
      : undefined,
    ...canonical(`/properties/${listing.slug}`),
  };
}

export default async function PropertyPage({ params }: Params) {
  const { slug } = await params;
  const listing = await load(slug);
  if (!listing) notFound();

  const related = await listRelatedListings(listing);

  return (
    <PropertyDetail listing={listing} related={related.ok ? related.data : []} />
  );
}
