import { getBookingStore } from "@/lib/booking";
import { addDays, businessToday } from "@/lib/booking/time";
import { ViewingCalendar } from "@/components/admin/ViewingCalendar";
import { PageHeader } from "@/components/admin/pieces";

export const dynamic = "force-dynamic";

export default async function AdminCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; date?: string }>;
}) {
  const { view, date } = await searchParams;
  const today = businessToday();

  // A wide window so month, week and day views can all be served without
  // another round trip when the agent moves around.
  const bookings = await getBookingStore().listBookings({
    from: addDays(today, -120),
    to: addDays(today, 240),
  });

  return (
    <div>
      <PageHeader title="Viewing calendar" subtitle="All property viewings · Yerevan time" />
      <ViewingCalendar
        bookings={bookings}
        initialView={view === "week" || view === "day" ? view : "month"}
        initialDate={date ?? today}
      />
    </div>
  );
}
