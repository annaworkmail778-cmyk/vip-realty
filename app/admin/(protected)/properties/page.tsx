import Link from "next/link";
import { getBookingStore } from "@/lib/booking";
import { PropertyViewingSettings } from "@/components/admin/PropertyViewingSettings";
import { PageHeader } from "@/components/admin/pieces";

export const dynamic = "force-dynamic";

export default async function AdminPropertiesPage() {
  const store = getBookingStore();
  const [properties, rules] = await Promise.all([store.listProperties(), store.listRules()]);

  return (
    <div>
      <PageHeader
        title="Properties"
        subtitle="How each listing is offered for viewing. Listing content stays in lib/properties.ts."
      />
      <div className="mt-8 overflow-x-auto">
        <table className="w-full min-w-[46rem] border-collapse text-left">
          <thead>
            <tr className="border-b border-ivory/15">
              {["Property", "Location", "Viewing mode", "Duration", "Own hours", ""].map((h) => (
                <th key={h} className="label py-3 pr-4 font-normal text-ivory/35">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {properties.map((p) => (
              <tr key={p.slug} className="border-b border-ivory/8">
                <td className="py-4 pr-4 text-[0.95rem] text-ivory">{p.title}</td>
                <td className="label py-4 pr-4 text-ivory/50">{p.location}</td>
                <td className="py-4 pr-4">
                  <PropertyViewingSettings
                    slug={p.slug}
                    mode={p.viewingMode}
                    duration={p.viewingDurationMinutes}
                  />
                </td>
                <td className="label py-4 pr-4 text-ivory/50">{p.viewingDurationMinutes} min</td>
                <td className="label py-4 pr-4 text-ivory/50">
                  {rules.some((r) => r.propertySlug === p.slug) ? "Yes" : "Agency default"}
                </td>
                <td className="py-4 pr-4">
                  <Link href={`/admin/availability?property=${p.slug}`} className="label text-champagne link-underline">
                    Hours
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
