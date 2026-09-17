import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PropertyDetail } from "@/components/PropertyDetail";
import { PROPERTIES, bySlug, formatPrice } from "@/lib/properties";

export function generateStaticParams() {
  return PROPERTIES.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({
  params,
}: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const property = bySlug(slug);
  if (!property) return { title: "Property not found" };

  return {
    title: property.name,
    description: `${property.summary} ${property.districtLabel}, ${property.city}. ${formatPrice(property)}.`,
    openGraph: { images: [property.media.wide] },
  };
}

export default async function PropertyPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const property = bySlug(slug);
  if (!property) notFound();
  return <PropertyDetail property={property} />;
}
