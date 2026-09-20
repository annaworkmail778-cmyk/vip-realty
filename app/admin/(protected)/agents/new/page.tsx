import Link from "next/link";
import { notFound } from "next/navigation";
import { DataNotice, PageHeader } from "@/components/admin/pieces";
import { AgentForm } from "@/components/admin/ManagementForms";
import { listAgencies } from "@/lib/admin/management";

export const dynamic = "force-dynamic";

export default async function NewAgentPage() {
  const agencies = await listAgencies();
  if (agencies.ok && agencies.data.length === 0) notFound();

  return (
    <div>
      <p className="label">
        <Link href="/admin/agents" className="link-underline text-ivory/45 hover:text-ivory">← Agents</Link>
      </p>
      <div className="mt-4">
        <PageHeader title="New agent" subtitle="Register their real WhatsApp identity — never invent one." />
      </div>
      {!agencies.ok ? (
        <DataNotice reason={agencies.reason === "unconfigured" ? "unconfigured" : "unavailable"} />
      ) : (
        <div className="mt-8"><AgentForm agencies={agencies.data} /></div>
      )}
    </div>
  );
}
