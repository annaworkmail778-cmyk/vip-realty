import Link from "next/link";
import { notFound } from "next/navigation";
import { DataNotice, PageHeader } from "@/components/admin/pieces";
import { AgentForm, GroupIdentityPanel } from "@/components/admin/ManagementForms";
import { getAgent, listAgencies, listUnlinkedSenders } from "@/lib/admin/management";
import { getAdminT } from "@/lib/admin/i18n.server";

export const dynamic = "force-dynamic";

export default async function EditAgentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [agent, agencies, senders, { t }] = await Promise.all([getAgent(id), listAgencies(), listUnlinkedSenders(), getAdminT()]);
  if (!agent.ok && agent.reason === "not_found") notFound();

  return (
    <div>
      <p className="label">
        <Link href="/admin/agents" className="link-underline text-ivory/45 hover:text-ivory">← {t("Agents")}</Link>
      </p>
      <div className="mt-4">
        <PageHeader
          title={agent.ok ? agent.data.name : t("Agent")}
          subtitle={agent.ok ? `${agent.data.agencyName} · ${t("{n} listing(s)", { n: agent.data.listingCount })}` : undefined}
        />
      </div>
      {!agent.ok || !agencies.ok ? (
        <DataNotice reason="unavailable" />
      ) : (
        <div className="mt-8 space-y-10">
          <GroupIdentityPanel agent={agent.data} senders={senders.ok ? senders.data : []} />
          <AgentForm agent={agent.data} agencies={agencies.data} />
        </div>
      )}
    </div>
  );
}
