import Link from "next/link";
import { DataNotice, EmptyState, ListingStatusPill, PageHeader, ReviewStatusPill, StatCard } from "@/components/admin/pieces";
import {
  LISTING_STATUSES,
  countAdminPropertiesByStatus,
  listAdminProperties,
  type ListingStatus,
} from "@/lib/admin/properties";

export const dynamic = "force-dynamic";

type Search = Record<string, string | string[] | undefined>;

const STATUS_LABEL: Record<ListingStatus, string> = {
  draft: "Draft",
  published: "Published",
  sold: "Sold",
  rented: "Rented",
  archived: "Archived",
};

const date = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Yerevan" }).format(new Date(iso)) : "—";

const price = (value: number | null, currency: string | null, period: string | null) => {
  if (value === null || !currency) return "—";
  const amount = new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
  return period ? `${amount} / ${period}` : amount;
};

/* Listing management: every property in Supabase, whatever its status. */
export default async function AdminPropertiesPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const raw = Array.isArray(sp.status) ? sp.status[0] : sp.status;
  const status = (LISTING_STATUSES as readonly string[]).includes(raw ?? "") ? (raw as ListingStatus) : null;

  const [rows, counts] = await Promise.all([listAdminProperties(status), countAdminPropertiesByStatus()]);

  return (
    <div>
      <PageHeader
        title="Properties"
        subtitle="Every listing in the database. Only published listings are visible on the website."
      />

      {!rows.ok ? (
        <DataNotice reason={rows.reason === "unconfigured" ? "unconfigured" : "unavailable"} />
      ) : (
        <>
          {counts.ok && (
            <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <StatCard
                value={Object.values(counts.data).reduce((a, b) => a + b, 0)}
                label="All"
                href="/admin/properties"
                active={status === null}
              />
              {LISTING_STATUSES.map((s) => (
                <StatCard
                  key={s}
                  value={counts.data[s]}
                  label={STATUS_LABEL[s]}
                  tone={s === "published" ? "accent" : s === "archived" ? "muted" : "default"}
                  href={`/admin/properties?status=${s}`}
                  active={status === s}
                />
              ))}
            </div>
          )}

          <div className="mt-8 overflow-x-auto">
            <table className="w-full min-w-[64rem] border-collapse text-left">
              <thead>
                <tr className="border-b border-ivory/15">
                  {["Title", "Status", "Review", "Intent · Type", "Location", "Price", "Created", "Updated"].map((h) => (
                    <th key={h} className="label py-3 pr-4 font-normal text-ivory/35">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.data.length === 0 ? (
                  <tr>
                    <td colSpan={8}>
                      <EmptyState>{status ? `No ${STATUS_LABEL[status].toLowerCase()} listings.` : "No listings yet."}</EmptyState>
                    </td>
                  </tr>
                ) : (
                  rows.data.map((p) => (
                    <tr key={p.id} className="border-b border-ivory/10 transition-colors duration-300 hover:bg-ivory/[0.03]">
                      <td className="py-3.5 pr-4">
                        <Link href={`/admin/properties/${p.id}`} className="link-underline text-[0.95rem] text-ivory">
                          {p.title ?? <span className="text-ivory/40">Untitled draft</span>}
                        </Link>
                        <p className="label mt-1 text-ivory/35">{p.slug}</p>
                      </td>
                      <td className="py-3.5 pr-4"><ListingStatusPill status={p.listingStatus} /></td>
                      <td className="py-3.5 pr-4"><ReviewStatusPill status={p.reviewStatus} /></td>
                      <td className="label py-3.5 pr-4 text-ivory/70">
                        {p.intent ?? "—"} · {p.propertyType ?? "—"}
                      </td>
                      <td className="label py-3.5 pr-4 text-ivory/70">
                        {[p.district, p.city].filter(Boolean).join(", ") || "—"}
                      </td>
                      <td className="label py-3.5 pr-4 text-champagne">{price(p.price, p.currency, p.pricePeriod)}</td>
                      <td className="label py-3.5 pr-4 text-ivory/50">{date(p.createdAt)}</td>
                      <td className="label py-3.5 pr-4 text-ivory/50">{date(p.updatedAt)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
