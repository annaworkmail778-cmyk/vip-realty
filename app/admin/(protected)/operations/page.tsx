import Link from "next/link";
import { DataNotice, PageHeader, StatCard } from "@/components/admin/pieces";
import { getOperationsStatus, websiteConfig, type Counts } from "@/lib/admin/operations";
import { getAdminT } from "@/lib/admin/i18n.server";
import { code, type AdminT } from "@/lib/admin/i18n";

export const dynamic = "force-dynamic";

const dateTimeIn = (dl: string, never: string) => (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat(dl, {
        day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Yerevan",
      }).format(new Date(iso))
    : never;

function CountList({ t, title, counts }: { t: AdminT; title: string; counts: Counts }) {
  const entries = Object.entries(counts).sort(([a], [b]) => a.localeCompare(b));
  return (
    <div className="border border-ivory/12 bg-ink px-5 py-5">
      <p className="label text-ivory/40">{title}</p>
      {entries.length === 0 ? (
        <p className="mt-3 text-[0.85rem] text-ivory/35">{t("none")}</p>
      ) : (
        <ul className="mt-3 space-y-1 text-[0.85rem]">
          {entries.map(([k, n]) => (
            <li key={k} className="flex justify-between gap-4"><span className="text-ivory/60">{code(t, k)}</span><span className="text-ivory">{n}</span></li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Check({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  // ✓ / ✗ are language-neutral
  return (
    <li className="flex gap-3 text-[0.88rem]">
      <span className={`label w-12 shrink-0 ${ok ? "text-champagne" : "text-ivory/60"}`}>{ok ? "✓" : "✗"}</span>
      <span className="text-ivory/75">{children}</span>
    </li>
  );
}

/* Operator status: pipeline health from `admin_operations_status()` (counts and event codes only) plus the website's
   own configuration as booleans. Read-only; nothing on this page changes data or activates anything. */
export default async function OperationsPage() {
  const config = websiteConfig();
  const [status, { t, dateLocale }] = await Promise.all([getOperationsStatus(), getAdminT()]);

  return (
    <div>
      <PageHeader
        title={t("Operations")}
        subtitle={t("Pipeline health and configuration. Counts only — no messages, phone numbers or credentials are shown.")}
      />

      <section className="mt-8">
        <h2 className="label text-ivory/40">{t("Website configuration")}</h2>
        <ul className="mt-4 space-y-2">
          <Check ok={config.publicDatabase}>{t("Public listings database")}</Check>
          <Check ok={config.adminDatabase}>{t("Admin database access (server only)")}</Check>
          <Check ok={config.adminCredential === "hash"}>{t("Admin password stored as a hash")}</Check>
          <Check ok={config.production}>{t("Running a production build")}</Check>
        </ul>
        <p className="mt-4 text-[0.8rem] leading-relaxed text-ivory/40">
          {t("The n8n automation and the WhatsApp connection are not visible from the website; their problems are reported in Telegram.")}
        </p>
      </section>

      {!status.ok ? (
        <DataNotice reason={status.reason === "unconfigured" ? "unconfigured" : "unavailable"} />
      ) : (
        <Body s={status.data} t={t} dateTime={dateTimeIn(dateLocale, t("never"))} />
      )}
    </div>
  );
}

function Body({ s, t, dateTime }: {
  s: Extract<Awaited<ReturnType<typeof getOperationsStatus>>, { ok: true }>["data"];
  t: AdminT;
  dateTime: (iso: string | null) => string;
}) {
  const attention = [
    { n: s.messages.failed, label: "messages failed" },
    { n: s.messages.unresolvedSender, label: "messages from unregistered senders" },
    { n: s.sessions.readyWaitingOver15m, label: "sessions ready but not picked up (15 min+)" },
    { n: s.sessions.processingOver15m, label: "sessions stuck processing (15 min+)" },
    { n: s.extractions.failedLast24h, label: "extractions failed (24 h)" },
    { n: s.media.held, label: "media held" },
    { n: s.media.byStatus.failed ?? 0, label: "media failed" },
    { n: s.media.expiredLeases, label: "media with an expired processing lease" },
    { n: s.media.deadlinePassedUnfinished, label: "media past the download deadline" },
    { n: s.events.last24hBySeverity.error ?? 0, label: "error events (24 h)" },
  ].filter((a) => a.n > 0);

  return (
    <div className="mt-10 space-y-12">
      <section>
        <h2 className="label text-ivory/40">{t("Needs attention")}</h2>
        {attention.length === 0 ? (
          <p className="mt-4 text-[0.88rem] text-ivory/55">{t("Nothing flagged.")}</p>
        ) : (
          <ul className="mt-4 space-y-1 text-[0.88rem]">
            {attention.map((a) => <li key={a.label}><span className="text-champagne">{a.n}</span> <span className="text-ivory/75">{t(a.label)}</span></li>)}
          </ul>
        )}
        <p className="mt-3 text-[0.8rem] text-ivory/40">
          <Link href="/admin/pipeline" className="link-underline text-ivory/70">{t("Pipeline")}</Link> ·{" "}
          <Link href="/admin/properties" className="link-underline text-ivory/70">{t("Listings")}</Link>
        </p>
      </section>

      <section>
        <h2 className="label text-ivory/40">{t("Agents")}</h2>
        <ul className="mt-4 space-y-2">
          <Check ok={s.readiness.activeAgents > 0}>
            {t("Active agents: {n}", { n: s.readiness.activeAgents })}
          </Check>
        </ul>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard value={s.listings.draftsPendingReview - s.listings.draftsWithoutAgency} label={t("Drafts awaiting review")} tone="accent" href="/admin/properties?status=review" />
        <StatCard value={s.listings.approvedNotPublished} label={t("Approved, not published")} href="/admin/properties?status=approved" />
        <StatCard value={s.listings.publiclyVisible} label={t("Visible on the website")} />
        <StatCard value={s.inquiries.new} label={t("New inquiries")} href="/admin/inquiries" />
      </section>
      {s.listings.draftsWithoutAgency > 0 && (
        <p className="text-[0.8rem] text-ivory/40">
          {t("{n} legacy draft(s) have no agency and cannot be published; they are excluded above.", { n: s.listings.draftsWithoutAgency })}
        </p>
      )}

      <section>
        <h2 className="label text-ivory/40">{t("WhatsApp intake")}</h2>
        <p className="mt-3 text-[0.85rem] text-ivory/60">
          {t("Last message received:")} <span className="text-ivory">{dateTime(s.messages.lastReceivedAt)}</span> · {t("last 24 h:")}{" "}
          <span className="text-ivory">{s.messages.last24h}</span> · {t("last automation event:")}{" "}
          <span className="text-ivory">{dateTime(s.events.lastEventAt)}</span>
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <CountList t={t} title={t("Messages")} counts={s.messages.byStatus} />
          <CountList t={t} title={t("Sessions")} counts={s.sessions.byStatus} />
          <CountList t={t} title={t("Extractions")} counts={s.extractions.byStatus} />
          <CountList t={t} title={t("Media")} counts={s.media.byStatus} />
          <CountList t={t} title={t("Listings")} counts={s.listings.byListingStatus} />
          <CountList t={t} title={t("Status commands (7 days)")} counts={s.statusCommands7d} />
          <CountList t={t} title={t("Events by severity (24 h)")} counts={s.events.last24hBySeverity} />
          <CountList t={t} title={t("Storage objects")} counts={s.storage} />
        </div>
      </section>

      <section>
        <h2 className="label text-ivory/40">{t("Recent warnings and errors (7 days)")}</h2>
        {s.events.recentProblems.length === 0 ? (
          <p className="mt-4 text-[0.88rem] text-ivory/55">{t("None.")}</p>
        ) : (
          <ul className="mt-4 divide-y divide-ivory/10 border-y border-ivory/10">
            {s.events.recentProblems.map((p) => (
              <li key={p.id} className="grid gap-2 py-3 text-[0.85rem] lg:grid-cols-[9rem_16rem_1fr_10rem]">
                <span className={p.severity === "error" ? "text-champagne" : "text-ivory/60"}>{code(t, p.severity)}</span>
                <span className="text-ivory/85">{p.eventType}</span>
                <span className="text-ivory/55">
                  {p.reason ?? ""}{p.source ? ` · ${p.source}` : ""}
                  {p.propertyId ? <> · <Link href={`/admin/properties/${p.propertyId}`} className="link-underline text-ivory">{t("listing")}</Link></> : null}
                </span>
                <span className="label text-ivory/40">{dateTime(p.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="label text-ivory/25">{t("Snapshot")} {dateTime(s.generatedAt)}</p>
    </div>
  );
}
