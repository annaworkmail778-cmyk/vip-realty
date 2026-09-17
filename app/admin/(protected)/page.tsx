import Link from "next/link";
import { dashboardData } from "@/lib/booking/admin-queries";
import { businessToday, formatDateLong } from "@/lib/booking/time";
import { BookingLine, EmptyState, PageHeader, StatCard } from "@/components/admin/pieces";

export const dynamic = "force-dynamic";

export default async function AdminDashboard() {
  const { today, upcoming, counts, recent } = await dashboardData();

  return (
    <div>
      <PageHeader title="Dashboard" subtitle={formatDateLong(businessToday())}>
        <Link href="/admin/bookings?new=1" className="label border border-ivory/25 px-4 py-3 text-ivory/80 transition-colors duration-300 hover:border-champagne hover:text-champagne">
          Add a viewing
        </Link>
      </PageHeader>

      <section className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard value={counts.today} label="Today's viewings" tone="accent" href="/admin/calendar?view=day" />
        <StatCard value={counts.upcoming} label="Upcoming" href="/admin/bookings" />
        <StatCard value={counts.pendingConfirmation} label="Pending confirmation" href="/admin/bookings" />
        <StatCard value={counts.completed} label="Completed" tone="muted" />
        <StatCard value={counts.cancelled} label="Cancelled" tone="muted" />
        <StatCard value={counts.noShow} label="No-shows" tone="muted" />
      </section>

      <div className="mt-12 grid gap-12 xl:grid-cols-2">
        <section>
          <h2 className="label text-ivory/40">Today</h2>
          <div className="mt-4">
            {today.length === 0
              ? <EmptyState>No viewings scheduled today.</EmptyState>
              : today.map((b) => <BookingLine key={b.id} booking={b} />)}
          </div>
        </section>

        <section>
          <h2 className="label text-ivory/40">Next up</h2>
          <div className="mt-4">
            {upcoming.length === 0
              ? <EmptyState>Nothing booked yet.</EmptyState>
              : upcoming.map((b) => <BookingLine key={b.id} booking={b} />)}
          </div>
        </section>
      </div>

      <section className="mt-12">
        <h2 className="label text-ivory/40">Recently booked</h2>
        <div className="mt-4">
          {recent.length === 0
            ? <EmptyState>No bookings yet.</EmptyState>
            : recent.map((b) => <BookingLine key={b.id} booking={b} />)}
        </div>
      </section>
    </div>
  );
}
