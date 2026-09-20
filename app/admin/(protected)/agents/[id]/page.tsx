import Link from "next/link";
import { notFound } from "next/navigation";
import { DataNotice, PageHeader } from "@/components/admin/pieces";
import { AgentForm } from "@/components/admin/ManagementForms";
import { getAgent, listAgencies } from "@/lib/admin/management";

export const dynamic = "force-dynamic";

export default async function EditAgentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [agent, agencies] = await Promise.all([getAgent(id), listAgencies()]);
  if (!agent.ok && agent.reason === "not_found") notFound();

  return (
    <div>
      <p className="label">
        <Link href="/admin/agents" className="link-underline text-ivory/45 hover:text-ivory">← Agents</Link>
      </p>
      <div className="mt-4">
        <PageHeader
          title={agent.ok ? agent.data.name : "Agent"}
          subtitle={agent.ok ? `${agent.data.agencyName} · ${agent.data.listingCount} listing(s)` : undefined}
        />
      </div>
      {!agent.ok || !agencies.ok ? (
        <DataNotice reason="unavailable" />
      ) : (
        <div className="mt-8"><AgentForm agent={agent.data} agencies={agencies.data} /></div>
      )}
    </div>
  );
}
