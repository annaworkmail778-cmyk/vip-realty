import Link from "next/link";
import { DataNotice, EmptyState, ListingStatusPill, PageHeader } from "@/components/admin/pieces";
import { INQUIRY_LIMIT, listInquiries } from "@/lib/admin/inquiries";

export const dynamic = "force-dynamic";

const dateTime = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Yerevan",
  }).format(new Date(iso));

/* Website inquiries, newest first. Read-only: follow-up happens by phone,
   WhatsApp or email; nothing here changes an inquiry. */
export default async function InquiriesPage() {
  const inquiries = await listInquiries();

  if (!inquiries.ok) {
    return (
      <div>
        <PageHeader title="Inquiries" />
        <DataNotice reason={inquiries.reason === "unconfigured" ? "unconfigured" : "unavailable"} />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Inquiries"
        subtitle={`"Request more information" submissions from the website, newest first (latest ${INQUIRY_LIMIT}). Times are Yerevan time.`}
      />

      {inquiries.data.length === 0 ? (
        <EmptyState>No inquiries yet. They appear here as soon as a visitor sends the form on the website.</EmptyState>
      ) : (
        <ul className="mt-8 divide-y divide-ivory/10 border-y border-ivory/10">
          {inquiries.data.map((q) => (
            <li key={q.id} className="grid gap-4 py-5 lg:grid-cols-[16rem_1fr]">
              <div className="space-y-1.5 text-[0.9rem]">
                <p className="text-ivory/90">{q.name}</p>
                {q.phone && (
                  <a href={`tel:${q.phone.replace(/[^\d+]/g, "")}`} className="label link-underline block text-champagne">
                    {q.phone}
                  </a>
                )}
                {q.email && (
                  <a href={`mailto:${q.email}`} className="label link-underline block break-all text-ivory/70">
                    {q.email}
                  </a>
                )}
                <p className="label text-ivory/40">
                  {dateTime(q.createdAt)}
                  {q.status !== "new" && <> · {q.status}</>}
                  {q.source !== "website" && <> · {q.source}</>}
                </p>
              </div>

              <div className="min-w-0 text-[0.9rem]">
                {q.property ? (
                  <p className="flex flex-wrap items-center gap-3">
                    <Link href={`/admin/properties/${q.property.id}`} className="link-underline text-ivory/85">
                      {q.property.title ?? q.property.slug}
                    </Link>
                    <ListingStatusPill status={q.property.listingStatus} />
                    {q.property.listingStatus === "published" && (
                      <a href={`/properties/${q.property.slug}`} target="_blank" rel="noreferrer"
                         className="label link-underline text-ivory/45 hover:text-ivory">
                        View on site
                      </a>
                    )}
                  </p>
                ) : (
                  <p className="label text-ivory/40">General inquiry (no listing)</p>
                )}
                {q.message && (
                  <p className="mt-3 max-w-[75ch] whitespace-pre-line break-words leading-relaxed text-ivory/65">
                    {q.message}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
