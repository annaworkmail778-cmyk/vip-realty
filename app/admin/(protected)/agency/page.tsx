import Link from "next/link";
import { DataNotice, EmptyState, PageHeader } from "@/components/admin/pieces";
import { listAgencies } from "@/lib/admin/management";

export const dynamic = "force-dynamic";

/* Agencies: the website's brand and contact details come from the one marked "Website". */
export default async function AgencyPage() {
  const result = await listAgencies();

  return (
    <div>
      <PageHeader title="Agency" subtitle="Public profile, contact details and WhatsApp routing.">
        <Link href="/admin/agency/new" className="label border border-ivory/25 px-4 py-2.5 hover:border-champagne">
          Add agency
        </Link>
      </PageHeader>

      {!result.ok ? (
        <DataNotice reason={result.reason === "unconfigured" ? "unconfigured" : "unavailable"} />
      ) : result.data.length === 0 ? (
        <div className="mt-8">
          <EmptyState>
            No agency yet. Create the agency that owns the listings — its public profile becomes the website&rsquo;s
            brand and contact details.
          </EmptyState>
          <Link href="/admin/agency/new" className="label bg-ivory px-5 py-2.5 text-ink hover:bg-champagne">
            Create the first agency
          </Link>
        </div>
      ) : (
        <ul className="mt-8 space-y-4">
          {result.data.map((a) => (
            <li key={a.id} className="border border-ivory/12 bg-ink p-5">
              <div className="flex flex-wrap items-center gap-3">
                <Link href={`/admin/agency/${a.id}`} className="font-display text-[1.3rem] text-ivory link-underline">
                  {a.displayName ?? a.name}
                </Link>
                {a.isSitePrimary && <span className="label border border-champagne/50 px-2 py-1 text-[0.55rem] text-champagne">Website</span>}
                {!a.isActive && <span className="label border border-ivory/20 px-2 py-1 text-[0.55rem] text-ivory/50">Inactive</span>}
              </div>
              <dl className="mt-4 grid gap-3 text-[0.85rem] sm:grid-cols-2 lg:grid-cols-4">
                <div><dt className="label text-ivory/35">Public phone</dt><dd className="text-ivory/80">{a.publicPhone ?? "—"}</dd></div>
                <div><dt className="label text-ivory/35">WhatsApp</dt><dd className="text-ivory/80">{a.publicWhatsapp ?? "—"}</dd></div>
                <div><dt className="label text-ivory/35">Agents</dt><dd className="text-ivory/80">{a.agentCount}</dd></div>
                <div><dt className="label text-ivory/35">Listings</dt><dd className="text-ivory/80">{a.listingCount} ({a.publishedCount} published)</dd></div>
              </dl>
              {a.isSitePrimary && !a.displayName && (
                <p className="label mt-4 text-champagne">
                  No public display name yet — the site still shows the project working name.
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
