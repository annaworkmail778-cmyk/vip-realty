import { getBookingStore } from "@/lib/booking";
import { hasTelegram } from "@/lib/env";
import { NotificationsPanel } from "@/components/admin/NotificationsPanel";
import { PageHeader } from "@/components/admin/pieces";

export const dynamic = "force-dynamic";

export default async function AdminNotificationsPage() {
  const events = await getBookingStore().listNotificationEvents(80);
  return (
    <div>
      <PageHeader
        title="Notifications"
        subtitle="Every booking change is queued here first, then delivered."
      />
      <NotificationsPanel events={events} telegramReady={hasTelegram()} />
    </div>
  );
}
