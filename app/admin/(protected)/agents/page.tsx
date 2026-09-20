import Link from "next/link";
import { DataNotice, EmptyState, PageHeader } from "@/components/admin/pieces";
import { LinkIdentityForm } from "@/components/admin/ManagementForms";
import { listAgencies, listAgents, listUnlinkedSenders } from "@/lib/admin/management";

export const dynamic = "force-dynamic";

const dateTime = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat("en-GB", {
        day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Yerevan",
      }).format(new Date(iso))
    : "—";

/** Identities are shown to the operator only; they never reach a public page. */
const mask = (value: string | null) =>
  value === null ? "—" : value.length <= 8 ? value : `${value.slice(0, 5)}…${value.slice(-4)}`;

const REASONS: Record<string, string> = {
  unknown_sender: "not registered",
  identity_conflict: "conflicts with a registered identity",
  agent_inactive: "agent is inactive",
  agency_mismatch: "wrong agency",
  agency_inactive: "agency is inactive",
  bsuid_not_registered: "user id not registered for this agent",
};

/* Agents and their WhatsApp identities: the people whose submissions become listings. */
export default async function AgentsPage() {
  const [agents, agencies, unlinked] = await Promise.all([listAgents(), listAgencies(), listUnlinkedSenders()]);

  if (!agents.ok) {
    return (
      <div>
        <PageHeader title="Agents" />
        <DataNotice reason={agents.reason === "unconfigured" ? "unconfigured" : "unavailable"} />
      </div>
    );
  }
  const hasAgency = agencies.ok && agencies.data.length > 0;

  return (
    <div>
      <PageHeader title="Agents" subtitle="Who may submit listings over WhatsApp, and under which identity.">
        {hasAgency && (
          <Link href="/admin/agents/new" className="label border border-ivory/25 px-4 py-2.5 hover:border-champagne">
            Add agent
          </Link>
        )}
      </PageHeader>

      {!hasAgency ? (
        <div className="mt-8">
          <EmptyState>Create an agency first — every agent belongs to one.</EmptyState>
          <Link href="/admin/agency/new" className="label bg-ivory px-5 py-2.5 text-ink hover:bg-champagne">
            Create an agency
          </Link>
        </div>
      ) : agents.data.length === 0 ? (
        <EmptyState>No agents yet. Add the agents who will send listings from their WhatsApp.</EmptyState>
      ) : (
        <div className="mt-8 overflow-x-auto">
          <table className="w-full min-w-[52rem] border-collapse text-left">
            <thead>
              <tr className="border-b border-ivory/15">
                {["Agent", "Agency", "WhatsApp id", "WhatsApp phone", "Listings", "Last message", ""].map((h) => (
                  <th key={h} className="label py-2 pr-3 font-normal text-ivory/35">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {agents.data.map((a) => (
                <tr key={a.id} className="border-b border-ivory/10">
                  <td className="py-3 pr-3 text-[0.9rem] text-ivory/85">
                    {a.name}
                    {!a.isActive && <span className="label ml-2 text-ivory/40">inactive</span>}
                  </td>
                  <td className="py-3 pr-3 text-[0.85rem] text-ivory/60">
                    {a.agencyName}{!a.agencyActive && <span className="label ml-2 text-ivory/40">inactive</span>}
                  </td>
                  <td className="py-3 pr-3 label text-ivory/60">{mask(a.whatsappUserId)}</td>
                  <td className="py-3 pr-3 label text-ivory/60">{a.whatsappPhone ?? "—"}</td>
                  <td className="py-3 pr-3 label text-ivory/60">{a.listingCount} ({a.publishedCount})</td>
                  <td className="py-3 pr-3 label text-ivory/40">{dateTime(a.lastMessageAt)}</td>
                  <td className="py-3 text-right">
                    <Link href={`/admin/agents/${a.id}`} className="label link-underline text-champagne">Edit</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <section className="mt-14">
        <h2 className="label text-ivory/40">Unregistered senders</h2>
        <p className="mt-3 max-w-[70ch] text-[0.85rem] leading-relaxed text-ivory/55">
          Direct messages the pipeline could not attribute to an agent. Nothing was created from them. Confirm out of
          band who sent a message, then register its identity on the right agent — the value is copied from the stored
          message, never typed.
        </p>
        {!unlinked.ok ? (
          <DataNotice reason={unlinked.reason === "unconfigured" ? "unconfigured" : "unavailable"} />
        ) : unlinked.data.length === 0 ? (
          <EmptyState>None.</EmptyState>
        ) : (
          <ul className="mt-4 divide-y divide-ivory/10 border-y border-ivory/10">
            {unlinked.data.map((s) => (
              <li key={s.messageId} className="grid gap-3 py-4 lg:grid-cols-[1fr_22rem]">
                <div className="text-[0.85rem]">
                  <p className="text-ivory/85">
                    {mask(s.whatsappUserId) !== "—" ? `id ${mask(s.whatsappUserId)}` : s.senderPhone ?? "unknown sender"}
                    <span className="text-ivory/40"> · {s.agencyName} · {dateTime(s.receivedAt)}</span>
                  </p>
                  <p className="label mt-1 text-ivory/40">
                    {REASONS[s.reason ?? ""] ?? s.reason ?? "unattributed"} · {s.messageCount} message(s)
                    {s.profileName ? ` · WhatsApp profile name: ${s.profileName} (not verified)` : ""}
                  </p>
                  {s.bodyPreview && <p className="mt-2 text-ivory/55">“{s.bodyPreview}”</p>}
                </div>
                <LinkIdentityForm sender={s} agents={agents.data} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
