import { getBookingStore } from "@/lib/booking";
import { addDays, businessToday } from "@/lib/booking/time";
import { BookingsBrowser } from "@/components/admin/BookingsBrowser";
import { PageHeader } from "@/components/admin/pieces";

export const dynamic = "force-dynamic";

export default async function AdminBookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string; new?: string }>;
}) {
  const { ref, new: isNew } = await searchParams;
  const store = getBookingStore();
  const today = businessToday();

  const [bookings, properties] = await Promise.all([
    store.listBookings({ from: addDays(today, -180), to: addDays(today, 180) }),
    store.listProperties(),
  ]);

  return (
    <div>
      <PageHeader title="Bookings" subtitle={`${bookings.length} in the last and next six months`} />
      <BookingsBrowser
        bookings={bookings}
        properties={properties.map((p) => ({ slug: p.slug, title: p.title, viewingMode: p.viewingMode }))}
        initialReference={ref ?? null}
        startCreating={isNew === "1"}
      />
    </div>
  );
}
