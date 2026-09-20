import Link from "next/link";
import { notFound } from "next/navigation";
import { DataNotice, PageHeader } from "@/components/admin/pieces";
import { AgencyForm } from "@/components/admin/ManagementForms";
import { getAgency } from "@/lib/admin/management";

export const dynamic = "force-dynamic";

export default async function EditAgencyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getAgency(id);
  if (!result.ok && result.reason === "not_found") notFound();

  return (
    <div>
      <p className="label">
        <Link href="/admin/agency" className="link-underline text-ivory/45 hover:text-ivory">← Agency</Link>
      </p>
      <div className="mt-4">
        <PageHeader
          title={result.ok ? result.data.displayName ?? result.data.name : "Agency"}
          subtitle={result.ok ? result.data.slug : undefined}
        />
      </div>
      {!result.ok ? (
        <DataNotice reason={result.reason === "unconfigured" ? "unconfigured" : "unavailable"} />
      ) : (
        <div className="mt-8"><AgencyForm agency={result.data} /></div>
      )}
    </div>
  );
}
