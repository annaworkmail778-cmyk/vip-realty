import { getBookingStore } from "@/lib/booking";
import { addDays, businessToday } from "@/lib/booking/time";
import { AvailabilityEditor } from "@/components/admin/AvailabilityEditor";
import { PageHeader } from "@/components/admin/pieces";

export const dynamic = "force-dynamic";

export default async function AdminAvailabilityPage({
  searchParams,
}: {
  searchParams: Promise<{ property?: string }>;
}) {
  const { property } = await searchParams;
  const store = getBookingStore();
  const today = businessToday();
  const scope = property && property !== "agency" ? property : null;

  const [properties, rules, blackouts, overrides] = await Promise.all([
    store.listProperties(),
    store.listRules(scope),
    store.listBlackouts(today, addDays(today, 120)),
    store.listDateOverrides(scope, today, addDays(today, 120)),
  ]);

  return (
    <div>
      <PageHeader
        title="Viewing availability"
        subtitle="Recurring hours, one-off dates and blocked time · Yerevan"
      />
      <AvailabilityEditor
        scope={scope}
        properties={properties.map((p) => ({ slug: p.slug, title: p.title, viewingMode: p.viewingMode, duration: p.viewingDurationMinutes }))}
        rules={rules}
        blackouts={blackouts}
        overrides={overrides}
      />
    </div>
  );
}
