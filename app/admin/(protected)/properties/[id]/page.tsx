import Link from "next/link";
import { notFound } from "next/navigation";
import { DataNotice, ListingStatusPill, PageHeader, ReviewStatusPill } from "@/components/admin/pieces";
import { getAdminProperty } from "@/lib/admin/properties";

export const dynamic = "force-dynamic";

const dateTime = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat("en-GB", {
        day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Yerevan",
      }).format(new Date(iso))
    : "—";

const show = (v: string | number | boolean | null | undefined) =>
  v === null || v === undefined || v === "" ? <span className="text-ivory/30">—</span> : String(v);

/* Read-only listing detail for admins. Editing and the WhatsApp review
   workflow arrive in later phases. */
export default async function AdminPropertyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getAdminProperty(id);

  if (!result.ok) {
    if (result.reason === "not_found") notFound();
    return (
      <div>
        <PageHeader title="Property" />
        <DataNotice reason={result.reason} />
      </div>
    );
  }

  const p = result.data;
  const price = p.price !== null && p.currency
    ? `${new Intl.NumberFormat("en-US", { style: "currency", currency: p.currency, maximumFractionDigits: 0 }).format(p.price)}${p.pricePeriod ? ` / ${p.pricePeriod}` : ""}`
    : null;

  const sections: { title: string; rows: [string, React.ReactNode][] }[] = [
    {
      title: "Listing",
      rows: [
        ["Slug", p.slug],
        ["Intent", show(p.intent)],
        ["Property type", show(p.propertyType)],
        ["Price", show(price)],
        ["Price negotiable", show(p.priceNegotiable === null ? null : p.priceNegotiable ? "Yes" : "No")],
        ["Featured", p.featured ? "Yes" : "No"],
        ["Source", show(p.source)],
      ],
    },
    {
      title: "Location",
      rows: [
        ["Country", show(p.country)],
        ["City", show(p.city)],
        ["District", show(p.district)],
        ["Address (private)", show(p.address)],
        ["Coordinates (private)", show(p.latitude !== null && p.longitude !== null ? `${p.latitude}, ${p.longitude}` : null)],
      ],
    },
    {
      title: "Characteristics",
      rows: [
        ["Area", show(p.areaSqm !== null ? `${p.areaSqm} m²` : null)],
        ["Land area", show(p.landAreaSqm !== null ? `${p.landAreaSqm} m²` : null)],
        ["Rooms", show(p.rooms)],
        ["Bedrooms", show(p.bedrooms)],
        ["Bathrooms", show(p.bathrooms)],
        ["Floor", show(p.floor !== null ? (p.totalFloors !== null ? `${p.floor} of ${p.totalFloors}` : p.floor) : null)],
        ["Year built", show(p.yearBuilt)],
        ["Features", show(p.features.length ? p.features.join(", ") : null)],
      ],
    },
    {
      title: "Lifecycle",
      rows: [
        ["Status", <ListingStatusPill key="s" status={p.listingStatus} />],
        ["Review", <ReviewStatusPill key="r" status={p.reviewStatus} />],
        ["Status changed", dateTime(p.listingStatusChangedAt)],
        ["Published", dateTime(p.publishedAt)],
        ["Created", dateTime(p.createdAt)],
        ["Updated", dateTime(p.updatedAt)],
      ],
    },
    {
      title: "Provenance",
      rows: [
        ["Property id", p.id],
        ["Agency id", show(p.agencyId)],
        ["Agent id", show(p.agentId)],
        ["Created from session", show(p.createdFromSessionId)],
        ["Metadata", show(Object.keys(p.metadata).length ? JSON.stringify(p.metadata) : null)],
      ],
    },
  ];

  return (
    <div>
      <p className="label">
        <Link href="/admin/properties" className="link-underline text-ivory/45 hover:text-ivory">← Properties</Link>
      </p>
      <div className="mt-4">
        <PageHeader title={p.title ?? "Untitled draft"} subtitle={p.slug}>
          <ListingStatusPill status={p.listingStatus} />
          <ReviewStatusPill status={p.reviewStatus} />
          {p.listingStatus === "published" && (
            <Link href={`/properties/${p.slug}`} target="_blank" className="label link-underline text-champagne">
              View on website ↗
            </Link>
          )}
        </PageHeader>
      </div>

      <div className="mt-8 grid gap-10 xl:grid-cols-[1fr_24rem]">
        <div className="space-y-10">
          {sections.map((section) => (
            <section key={section.title}>
              <h2 className="label text-ivory/40">{section.title}</h2>
              <dl className="mt-4 divide-y divide-ivory/10 border-y border-ivory/10">
                {section.rows.map(([label, value]) => (
                  <div key={label} className="grid gap-2 py-3 sm:grid-cols-[12rem_1fr]">
                    <dt className="label text-ivory/40">{label}</dt>
                    <dd className="break-words text-[0.9rem] text-ivory/85">{value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}

          <section>
            <h2 className="label text-ivory/40">Description</h2>
            <p className="mt-4 whitespace-pre-line text-[0.9rem] leading-relaxed text-ivory/75">
              {p.description ?? <span className="text-ivory/30">No description.</span>}
            </p>
          </section>
        </div>

        <section>
          <h2 className="label text-ivory/40">Images ({p.images.length})</h2>
          {p.images.length === 0 ? (
            <p className="label mt-4 text-ivory/30">No images.</p>
          ) : (
            <ul className="mt-4 grid grid-cols-2 gap-3">
              {p.images.map((img) => (
                <li key={img.id} className="border border-ivory/10 bg-ink">
                  <div className="relative aspect-[4/3] overflow-hidden bg-black">
                    {img.url && (
                      // Admin thumbnails are loaded directly from Storage (no optimisation needed).
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={img.url} alt={img.altText ?? ""} className="h-full w-full object-cover" loading="lazy" />
                    )}
                  </div>
                  <p className="label px-3 py-2 text-ivory/50">
                    #{img.sortOrder}{img.isPrimary ? " · Primary" : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
