import { customerSummaries } from "@/lib/booking/admin-queries";
import { formatDateShort } from "@/lib/booking/time";
import { PageHeader, EmptyState } from "@/components/admin/pieces";

export const dynamic = "force-dynamic";

export default async function AdminCustomersPage() {
  const customers = await customerSummaries();

  return (
    <div>
      <PageHeader
        title="Customers"
        subtitle="Derived from bookings — guests never create an account."
      />

      {customers.length === 0 ? (
        <EmptyState>No customers yet.</EmptyState>
      ) : (
        <div className="mt-8 overflow-x-auto">
          <table className="w-full min-w-[46rem] border-collapse text-left">
            <thead>
              <tr className="border-b border-ivory/15">
                {["Name", "Phone", "Email", "Viewings", "Latest", "Contact consent"].map((h) => (
                  <th key={h} className="label py-3 pr-4 font-normal text-ivory/35">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => (
                <tr key={c.email} className="border-b border-ivory/8">
                  <td className="py-4 pr-4 text-[0.95rem] text-ivory">{c.name}</td>
                  <td className="label py-4 pr-4 text-ivory/60">
                    <a href={`tel:${c.phone.replace(/\s/g, "")}`} className="link-underline">{c.phone}</a>
                  </td>
                  <td className="label py-4 pr-4 text-ivory/60">
                    <a href={`mailto:${c.email}`} className="link-underline">{c.email}</a>
                  </td>
                  <td className="label py-4 pr-4 text-champagne">{c.bookings}</td>
                  <td className="label py-4 pr-4 text-ivory/50">{formatDateShort(c.lastDate)}</td>
                  <td className="label py-4 pr-4 text-ivory/50">{c.consent ? "Given" : "Not given"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
