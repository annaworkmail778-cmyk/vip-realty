import Link from "next/link";
import { DataNotice, EmptyState, ListingStatusPill, PageHeader, ReviewStatusPill, StatCard } from "@/components/admin/pieces";
import { BLOCKER_LABELS, label } from "@/lib/admin/labels";
import { getAdminT } from "@/lib/admin/i18n.server";
import { code, type AdminT } from "@/lib/admin/i18n";
import { QUEUE_FILTERS, countReviewQueue, listReviewQueue, type QueueFilter } from "@/lib/admin/properties";

export const dynamic = "force-dynamic";

type Search = Record<string, string | string[] | undefined>;

const FILTER_LABEL: Record<QueueFilter, string> = {
  review: "Pending review",
  approved: "Draft · approved",
  rejected: "Draft · rejected",
  published: "Published",
  sold: "Sold",
  rented: "Rented",
  archived: "Archived",
  all: "All",
};

const date = (dl: string, iso: string | null) =>
  iso ? new Intl.DateTimeFormat(dl, { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Yerevan" }).format(new Date(iso)) : "—";

const price = (t: AdminT, value: number | null, currency: string | null, period: string | null) => {
  if (value === null || !currency) return "—";
  const amount = new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
  return period ? `${amount} / ${code(t, period)}` : amount;
};

/* Review queue: drafts waiting for a decision first, then every lifecycle state. */
export default async function AdminPropertiesPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const raw = Array.isArray(sp.status) ? sp.status[0] : sp.status;
  const filter: QueueFilter = (QUEUE_FILTERS as readonly string[]).includes(raw ?? "") ? (raw as QueueFilter) : "review";

  const [rows, counts, { t, dateLocale }] = await Promise.all([listReviewQueue(filter), countReviewQueue(), getAdminT()]);

  return (
    <div>
      <PageHeader
        title={t("Listings")}
        subtitle={t("Review WhatsApp drafts, publish approved listings and manage their status. Only published listings are on the website.")}
      />

      {!rows.ok ? (
        <DataNotice reason={rows.reason === "unconfigured" ? "unconfigured" : "unavailable"} />
      ) : (
        <>
          {counts.ok && (
            <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
              {QUEUE_FILTERS.map((f) => (
                <StatCard
                  key={f}
                  value={counts.data[f]}
                  label={t(FILTER_LABEL[f])}
                  tone={f === "review" ? "accent" : f === "archived" ? "muted" : "default"}
                  href={`/admin/properties?status=${f}`}
                  active={filter === f}
                />
              ))}
            </div>
          )}

          <div className="mt-8 overflow-x-auto">
            <table className="w-full min-w-[78rem] border-collapse text-left">
              <thead>
                <tr className="border-b border-ivory/15">
                  {["Listing", "Status", "Intent · Type", "Price", "Location", "Agent · Agency", "Extraction", "Photos", "Publishable", "Created"].map((h) => (
                    <th key={h} className="label py-3 pr-4 font-normal text-ivory/35">{t(h)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.data.length === 0 ? (
                  <tr>
                    <td colSpan={10}>
                      <EmptyState>{filter === "review" ? t("Nothing waiting for review.") : t("No listings in “{filter}”.", { filter: t(FILTER_LABEL[filter]) })}</EmptyState>
                    </td>
                  </tr>
                ) : (
                  rows.data.map((p) => {
                    const pending = (p.mediaCounts.received ?? 0) + (p.mediaCounts.downloading ?? 0) + (p.mediaCounts.downloaded ?? 0)
                      + (p.mediaCounts.validating ?? 0) + (p.mediaCounts.attaching ?? 0) + (p.mediaCounts.uploaded ?? 0);
                    const problems = (p.mediaCounts.rejected ?? 0) + (p.mediaCounts.failed ?? 0) + (p.mediaCounts.expired ?? 0);
                    return (
                      <tr key={p.id} className="border-b border-ivory/10 align-top transition-colors duration-300 hover:bg-ivory/[0.03]">
                        <td className="py-3.5 pr-4">
                          <Link href={`/admin/properties/${p.id}`} className="link-underline text-[0.95rem] text-ivory">
                            {p.title ?? <span className="text-ivory/40">{t("Untitled draft")}</span>}
                          </Link>
                          <p className="label mt-1 text-ivory/35">{p.slug}</p>
                        </td>
                        <td className="space-y-1.5 py-3.5 pr-4">
                          <ListingStatusPill status={p.listingStatus} />
                          <div><ReviewStatusPill status={p.reviewStatus} /></div>
                        </td>
                        <td className="label py-3.5 pr-4 text-ivory/70">{code(t, p.intent)} · {code(t, p.propertyType)}</td>
                        <td className="label py-3.5 pr-4 text-champagne">{price(t, p.price, p.currency, p.pricePeriod)}</td>
                        <td className="label py-3.5 pr-4 text-ivory/70">{[p.district, p.city].filter(Boolean).join(", ") || "—"}</td>
                        <td className="label py-3.5 pr-4 text-ivory/70">
                          {p.agentName ?? "—"}{p.agentActive === false ? ` (${t("inactive")})` : ""}
                          <p className="mt-1 text-ivory/40">{p.agencyName ?? t("no agency")}</p>
                        </td>
                        <td className="label py-3.5 pr-4 text-ivory/70">
                          {p.extractionStatus ? code(t, p.extractionStatus) : p.source === "whatsapp" ? t("missing") : "—"}
                          {p.conflictCount > 0 && <p className="mt-1 text-champagne">{t("{n} conflict(s)", { n: p.conflictCount })}</p>}
                        </td>
                        <td className="label py-3.5 pr-4 text-ivory/70">
                          {p.imageCount}
                          {pending > 0 && <p className="mt-1 text-ivory/45">{t("{n} processing", { n: pending })}</p>}
                          {problems > 0 && <p className="mt-1 text-champagne">{t("{n} problem(s)", { n: problems })}</p>}
                        </td>
                        <td className="label py-3.5 pr-4">
                          {p.listingStatus === "published" ? (
                            <span className="text-ivory/40">{t("live")}</span>
                          ) : p.publication.publishable ? (
                            <span className="text-champagne">{t("Ready")}</span>
                          ) : (
                            <span className="text-ivory/55" title={p.publication.blockers.map((b) => t(label(BLOCKER_LABELS, b))).join("; ")}>
                              {t(label(BLOCKER_LABELS, p.publication.blockers[0]))}
                              {p.publication.blockers.length > 1 ? ` +${p.publication.blockers.length - 1}` : ""}
                            </span>
                          )}
                        </td>
                        <td className="label py-3.5 pr-4 text-ivory/50">{date(dateLocale, p.createdAt)}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
