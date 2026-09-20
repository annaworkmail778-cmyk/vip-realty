import Link from "next/link";
import { notFound } from "next/navigation";
import { DataNotice, ListingStatusPill, PageHeader, ReviewStatusPill } from "@/components/admin/pieces";
import { ListingEditForm } from "@/components/admin/ManagementForms";
import { getReviewDetail } from "@/lib/admin/properties";

export const dynamic = "force-dynamic";

/* Human correction of a listing's content. Ownership, provenance, lifecycle and review state are not editable
   here — the database refuses anything outside the content whitelist. */
export default async function EditListingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getReviewDetail(id);
  if (!result.ok && result.reason === "not_found") notFound();

  if (!result.ok) {
    return (
      <div>
        <PageHeader title="Edit listing" />
        <DataNotice reason={result.reason === "unconfigured" ? "unconfigured" : "unavailable"} />
      </div>
    );
  }

  const p = result.data;
  if (p.agencyName === null) {
    return (
      <div>
        <PageHeader title={p.title ?? "Listing"} subtitle={p.slug} />
        <p className="mt-8 label text-ivory/40">Legacy listing without an agency — editing is disabled.</p>
      </div>
    );
  }

  return (
    <div>
      <p className="label">
        <Link href={`/admin/properties/${p.id}`} className="link-underline text-ivory/45 hover:text-ivory">
          ← Listing
        </Link>
      </p>
      <div className="mt-4">
        <PageHeader title={`Edit: ${p.title ?? "Untitled draft"}`} subtitle={p.slug}>
          <ListingStatusPill status={p.listingStatus} />
          <ReviewStatusPill status={p.reviewStatus} />
        </PageHeader>
      </div>

      <div className="mt-8 max-w-4xl">
        <ListingEditForm
          listing={{
            id: p.id,
            stateVersion: p.stateVersion,
            title: p.title,
            description: p.description,
            intent: p.intent,
            propertyType: p.propertyType,
            price: p.price,
            currency: p.currency,
            pricePeriod: p.pricePeriod,
            priceNegotiable: p.priceNegotiable,
            areaSqm: p.areaSqm,
            landAreaSqm: p.landAreaSqm,
            rooms: p.rooms,
            bedrooms: p.bedrooms,
            bathrooms: p.bathrooms,
            floor: p.floor,
            totalFloors: p.totalFloors,
            yearBuilt: p.yearBuilt,
            country: p.country,
            city: p.city,
            district: p.district,
            address: p.address,
            features: p.features,
            listingStatus: p.listingStatus,
            reviewStatus: p.reviewStatus,
          }}
        />
      </div>
    </div>
  );
}
