import Link from "next/link";

/* Small shared building blocks for the admin screens. */

export function PageHeader({
  title, subtitle, children,
}: { title: string; subtitle?: string; children?: React.ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-5 border-b border-ivory/12 pb-6">
      <div>
        <h1 className="font-display text-[2rem] leading-none">{title}</h1>
        {subtitle && <p className="label mt-3 text-ivory/45">{subtitle}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-3">{children}</div>}
    </header>
  );
}

export function StatCard({
  value, label, tone = "default", href, active = false,
}: {
  value: number | string; label: string; tone?: "default" | "accent" | "muted"; href?: string; active?: boolean;
}) {
  const body = (
    <div
      className={`border bg-ink px-5 py-6 transition-colors duration-300 hover:border-ivory/25 ${
        active ? "border-champagne/60" : "border-ivory/12"
      }`}
    >
      <p className={`font-display text-[2.4rem] leading-none ${tone === "accent" ? "text-champagne" : tone === "muted" ? "text-ivory/45" : "text-ivory"}`}>
        {value}
      </p>
      <p className="label mt-3 text-ivory/40">{label}</p>
    </div>
  );
  return href ? <Link href={href} className="block">{body}</Link> : body;
}

const LISTING_TONE: Record<string, string> = {
  draft: "border-ivory/25 text-ivory/70",
  published: "border-champagne/60 text-champagne",
  sold: "border-ivory/20 text-ivory/55",
  rented: "border-ivory/20 text-ivory/55",
  archived: "border-ivory/12 text-ivory/35",
};

const REVIEW_TONE: Record<string, string> = {
  pending: "border-ivory/25 text-ivory/70",
  approved: "border-champagne/40 text-champagne/80",
  rejected: "border-ivory/12 text-ivory/40 line-through",
};

const LABELS: Record<string, string> = {
  draft: "Draft",
  published: "Published",
  sold: "Sold",
  rented: "Rented",
  archived: "Archived",
  pending: "Pending review",
  approved: "Approved",
  rejected: "Rejected",
};

function Pill({ tone, children }: { tone: string; children: React.ReactNode }) {
  return <span className={`label inline-block whitespace-nowrap border px-2.5 py-1 text-[0.55rem] ${tone}`}>{children}</span>;
}

/** Public listing lifecycle status. */
export function ListingStatusPill({ status }: { status: string }) {
  return <Pill tone={LISTING_TONE[status] ?? "border-ivory/20 text-ivory/60"}>{LABELS[status] ?? status}</Pill>;
}

/** Human review state (separate from the listing status). */
export function ReviewStatusPill({ status }: { status: string | null }) {
  if (!status) return <span className="label text-ivory/30">Not in review</span>;
  return <Pill tone={REVIEW_TONE[status] ?? "border-ivory/20 text-ivory/60"}>{LABELS[status] ?? status}</Pill>;
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return <p className="label py-10 text-ivory/30">{children}</p>;
}

/** Shown when admin data cannot be loaded. Never includes internal errors. */
export function DataNotice({ reason }: { reason: "unconfigured" | "unavailable" }) {
  return (
    <div className="mt-8 border border-champagne/30 bg-champagne/5 p-5">
      <p className="label text-champagne">{reason === "unconfigured" ? "Not configured" : "Temporarily unavailable"}</p>
      <p className="mt-3 text-[0.88rem] leading-relaxed text-ivory/70">
        {reason === "unconfigured" ? (
          <>
            Listing management needs server-side database access. Set{" "}
            <code className="text-champagne">SUPABASE_SERVICE_ROLE_KEY</code> in{" "}
            <code className="text-champagne">.env.local</code> (never in client code) and restart the server.
          </>
        ) : (
          "The database could not be reached. Try again in a moment."
        )}
      </p>
    </div>
  );
}
