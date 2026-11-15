import Link from "next/link";
import { DataNotice, EmptyState, PageHeader } from "@/components/admin/pieces";
import { NewAgentForm } from "@/components/admin/ManagementForms";
import { listAgencies, listUnlinkedSenders } from "@/lib/admin/management";
import { getAdminT } from "@/lib/admin/i18n.server";

export const dynamic = "force-dynamic";

/* Adding an agent is one form: name, the phone visitors see on their listings, and their message in the group. */
export default async function NewAgentPage() {
  const [agencies, senders, { t }] = await Promise.all([listAgencies(), listUnlinkedSenders(), getAdminT()]);

  return (
    <div>
      <p className="label">
        <Link href="/admin/agents" className="link-underline text-ivory/45 hover:text-ivory">← {t("Agents")}</Link>
      </p>
      <div className="mt-4">
        <PageHeader title={t("New agent")} subtitle={t("Three steps: name, phone, and their message in the WhatsApp group.")} />
      </div>
      {!agencies.ok ? (
        <DataNotice reason={agencies.reason === "unconfigured" ? "unconfigured" : "unavailable"} />
      ) : agencies.data.filter((a) => a.isActive).length === 0 ? (
        <div className="mt-8">
          <EmptyState>{t("Create an agency first — every agent belongs to one.")}</EmptyState>
          <Link href="/admin/agency/new" className="label bg-ivory px-5 py-2.5 text-ink hover:bg-champagne">
            {t("Create an agency")}
          </Link>
        </div>
      ) : (
        <div className="mt-8">
          <NewAgentForm agencies={agencies.data} senders={senders.ok ? senders.data : []} />
        </div>
      )}
    </div>
  );
}
