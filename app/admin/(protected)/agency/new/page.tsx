import Link from "next/link";
import { PageHeader } from "@/components/admin/pieces";
import { AgencyForm } from "@/components/admin/ManagementForms";
import { getAdminT } from "@/lib/admin/i18n.server";

export const dynamic = "force-dynamic";

export default async function NewAgencyPage() {
  const { t } = await getAdminT();
  return (
    <div>
      <p className="label">
        <Link href="/admin/agency" className="link-underline text-ivory/45 hover:text-ivory">← {t("Agency")}</Link>
      </p>
      <div className="mt-4">
        <PageHeader title={t("New agency")} subtitle={t("Only real values — the site refuses placeholder contact details.")} />
      </div>
      <div className="mt-8"><AgencyForm /></div>
    </div>
  );
}
