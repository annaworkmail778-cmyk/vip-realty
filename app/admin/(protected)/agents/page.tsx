import Link from "next/link";
import { DataNotice, EmptyState, PageHeader } from "@/components/admin/pieces";
import { DismissSenderButton, LinkIdentityForm } from "@/components/admin/ManagementForms";
import { listAgencies, listAgents, listUnlinkedSenders } from "@/lib/admin/management";
import { getAdminT } from "@/lib/admin/i18n.server";

export const dynamic = "force-dynamic";

const dateTimeIn = (dl: string) => (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat(dl, {
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
  lid_not_registered: "not registered",
};

/* Agents and their WhatsApp identities: the people whose submissions become listings. */
export default async function AgentsPage() {
  const [agents, agencies, unlinked, { t, dateLocale }] =
    await Promise.all([listAgents(), listAgencies(), listUnlinkedSenders(), getAdminT()]);
  const dateTime = dateTimeIn(dateLocale);

  if (!agents.ok) {
    return (
      <div>
        <PageHeader title={t("Agents")} />
        <DataNotice reason={agents.reason === "unconfigured" ? "unconfigured" : "unavailable"} />
      </div>
    );
  }
  const hasAgency = agencies.ok && agencies.data.length > 0;

  return (
    <div>
      <PageHeader title={t("Agents")} subtitle={t("The agents whose listings in the WhatsApp group become listings on the website.")}>
        {hasAgency && (
          <Link href="/admin/agents/new" className="label bg-ivory px-4 py-2.5 text-ink hover:bg-champagne">
            + {t("Add agent")}
          </Link>
        )}
      </PageHeader>

      {!hasAgency ? (
        <div className="mt-8">
          <EmptyState>{t("Create an agency first — every agent belongs to one.")}</EmptyState>
          <Link href="/admin/agency/new" className="label bg-ivory px-5 py-2.5 text-ink hover:bg-champagne">
            {t("Create an agency")}
          </Link>
        </div>
      ) : agents.data.length === 0 ? (
        <EmptyState>{t("No agents yet. Add the agents who will send listings from their WhatsApp.")}</EmptyState>
      ) : (
        <div className="mt-8 overflow-x-auto">
          <table className="w-full min-w-[52rem] border-collapse text-left">
            <thead>
              <tr className="border-b border-ivory/15">
                {["Agent", "Phone shown on listings", "WhatsApp group", "Listings (published)", "Last message", ""].map((h) => (
                  <th key={h} className="label py-2 pr-3 font-normal text-ivory/35">{h && t(h)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {agents.data.map((a) => (
                <tr key={a.id} className="border-b border-ivory/10">
                  <td className="py-3 pr-3 text-[0.9rem] text-ivory/85">
                    {a.name}
                    {!a.isActive && <span className="label ml-2 text-ivory/40">{t("inactive")}</span>}
                  </td>
                  <td className="py-3 pr-3 label text-ivory/70">{a.phone ?? a.whatsappPhone ?? "—"}</td>
                  <td className="py-3 pr-3 label">
                    {a.groupIdentity
                      ? <span className="text-champagne">✓ {a.groupIdentity.profileName ?? t("Linked")}</span>
                      : <Link href={`/admin/agents/${a.id}`} className="link-underline text-ivory/70">✗ {t("Not linked")}</Link>}
                  </td>
                  <td className="py-3 pr-3 label text-ivory/60">{a.listingCount} ({a.publishedCount})</td>
                  <td className="py-3 pr-3 label text-ivory/40">{dateTime(a.lastMessageAt)}</td>
                  <td className="py-3 text-right">
                    <Link href={`/admin/agents/${a.id}`} className="label link-underline text-champagne">{t("Edit")}</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <section className="mt-14">
        <h2 className="label text-ivory/40">{t("Unrecognised senders in the WhatsApp group")}</h2>
        <p className="mt-3 max-w-[70ch] text-[0.85rem] leading-relaxed text-ivory/55">
          {t("Messages from people who are not linked to an agent yet. Nothing was created from them. If one of them is an agent, choose who it is and press Link — their listings will be processed from then on.")}
        </p>
        {!unlinked.ok ? (
          <DataNotice reason={unlinked.reason === "unconfigured" ? "unconfigured" : "unavailable"} />
        ) : unlinked.data.length === 0 ? (
          <EmptyState>{t("None.")}</EmptyState>
        ) : (
          <ul className="mt-4 divide-y divide-ivory/10 border-y border-ivory/10">
            {unlinked.data.map((s) => (
              <li key={s.messageId} className="grid gap-3 py-4 lg:grid-cols-[1fr_22rem]">
                <div className="text-[0.85rem]">
                  <p className="text-ivory/85">
                    {s.profileName ?? s.senderPhone ?? (mask(s.whatsappUserId) !== "—" ? `id ${mask(s.whatsappUserId)}` : t("unknown sender"))}
                    <span className="text-ivory/40"> · {s.agencyName} · {dateTime(s.receivedAt)}</span>
                  </p>
                  <p className="label mt-1 text-ivory/40">
                    {t(REASONS[s.reason ?? ""] ?? s.reason ?? "unattributed")} · {t("{n} message(s)", { n: s.messageCount })}
                    {s.profileName ? ` · ${t("WhatsApp profile name (not verified)")}` : ""}
                  </p>
                  {s.bodyPreview && <p className="mt-2 text-ivory/55">“{s.bodyPreview}”</p>}
                </div>
                <div className="space-y-3">
                  <LinkIdentityForm sender={s} agents={agents.data} />
                  <DismissSenderButton messageId={s.messageId} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
