import Link from "next/link";
import { formatDateShort, formatTime24 } from "@/lib/booking/time";
import { CONFIRMATION_LABELS, STATUS_LABELS, type Booking } from "@/lib/booking/types";

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
  value, label, tone = "default", href,
}: { value: number | string; label: string; tone?: "default" | "accent" | "muted"; href?: string }) {
  const body = (
    <div className="border border-ivory/12 bg-ink px-5 py-6 transition-colors duration-300 hover:border-ivory/25">
      <p className={`font-display text-[2.4rem] leading-none ${tone === "accent" ? "text-champagne" : tone === "muted" ? "text-ivory/45" : "text-ivory"}`}>
        {value}
      </p>
      <p className="label mt-3 text-ivory/40">{label}</p>
    </div>
  );
  return href ? <Link href={href} className="block">{body}</Link> : body;
}

const STATUS_TONE: Record<string, string> = {
  pending: "border-ivory/25 text-ivory/70",
  confirmed: "border-champagne/60 text-champagne",
  cancelled: "border-ivory/12 text-ivory/35 line-through",
  completed: "border-ivory/20 text-ivory/55",
  no_show: "border-ivory/20 text-ivory/40",
};

export function StatusPill({ status }: { status: Booking["status"] }) {
  return (
    <span className={`label inline-block border px-2.5 py-1 text-[0.55rem] ${STATUS_TONE[status] ?? ""}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}

export function ConfirmationNote({ booking }: { booking: Booking }) {
  const tone = booking.confirmationStatus === "confirmed" ? "text-champagne"
    : booking.confirmationStatus === "expired" ? "text-ivory/35" : "text-ivory/50";
  return <span className={`label ${tone}`}>{CONFIRMATION_LABELS[booking.confirmationStatus]}</span>;
}

export function BookingLine({ booking }: { booking: Booking }) {
  return (
    <Link
      href={`/admin/bookings?ref=${booking.reference}`}
      className="flex flex-wrap items-baseline gap-x-5 gap-y-1 border-b border-ivory/10 py-3.5 transition-colors duration-300 hover:bg-ivory/[0.03]"
    >
      <span className="label w-[7.5rem] shrink-0 text-champagne">{formatTime24(booking.startTime)}</span>
      <span className="min-w-0 flex-1 text-[0.95rem] text-ivory">{booking.customerName}</span>
      <span className="label min-w-0 flex-1 text-ivory/55">{booking.propertyTitle}</span>
      <span className="label text-ivory/35">{formatDateShort(booking.date)}</span>
      <StatusPill status={booking.status} />
    </Link>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return <p className="label py-10 text-ivory/30">{children}</p>;
}
