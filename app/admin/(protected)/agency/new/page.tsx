import Link from "next/link";
import { PageHeader } from "@/components/admin/pieces";
import { AgencyForm } from "@/components/admin/ManagementForms";

export const dynamic = "force-dynamic";

export default function NewAgencyPage() {
  return (
    <div>
      <p className="label">
        <Link href="/admin/agency" className="link-underline text-ivory/45 hover:text-ivory">← Agency</Link>
      </p>
      <div className="mt-4">
        <PageHeader title="New agency" subtitle="Only real values — the site refuses placeholder contact details." />
      </div>
      <div className="mt-8"><AgencyForm /></div>
    </div>
  );
}
