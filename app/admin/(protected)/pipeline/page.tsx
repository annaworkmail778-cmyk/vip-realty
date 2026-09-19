import Link from "next/link";
import { DataNotice, EmptyState, PageHeader } from "@/components/admin/pieces";
import { RetryMediaButton } from "@/components/admin/ReviewActions";
import { MEDIA_REASON_LABELS, label } from "@/lib/admin/labels";
import { listMediaIssues, listSubmissionIssues } from "@/lib/admin/properties";

export const dynamic = "force-dynamic";

const dateTime = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat("en-GB", {
        day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Yerevan",
      }).format(new Date(iso))
    : "—";

const GROUPS: { key: string; title: string; match: (status: string, reason: string | null) => boolean }[] = [
  { key: "held", title: "Held media", match: (s, r) => (s === "validated" || s === "uploaded") && (r ?? "").startsWith("held:") },
  { key: "rejected", title: "Rejected media", match: (s) => s === "rejected" },
  { key: "failed", title: "Failed media", match: (s) => s === "failed" },
  { key: "expired", title: "Expired media", match: (s) => s === "expired" },
];

/* Problems in the automated pipeline that no listing shows on its own: media that could not be attached and
   submissions that did not become a clean draft. Read-only except the database-defined media retry. */
export default async function PipelinePage() {
  const [media, submissions] = await Promise.all([listMediaIssues(), listSubmissionIssues()]);

  return (
    <div>
      <PageHeader
        title="Pipeline"
        subtitle="WhatsApp media and submissions that need attention. Nothing here is visible on the website."
      />

      {!media.ok || !submissions.ok ? (
        <DataNotice reason={(!media.ok && media.reason === "unconfigured") || (!submissions.ok && submissions.reason === "unconfigured") ? "unconfigured" : "unavailable"} />
      ) : (
        <div className="mt-8 space-y-12">
          {GROUPS.map((g) => {
            const rows = media.data.filter((m) => g.match(m.status, m.reason));
            return (
              <section key={g.key}>
                <h2 className="label text-ivory/40">{g.title} ({rows.length})</h2>
                {rows.length === 0 ? (
                  <EmptyState>None.</EmptyState>
                ) : (
                  <ul className="mt-4 divide-y divide-ivory/10 border-y border-ivory/10">
                    {rows.map((m) => (
                      <li key={m.mediaId} className="grid gap-3 py-3 text-[0.85rem] lg:grid-cols-[14rem_1fr_12rem_10rem]">
                        <span className="text-ivory/85">{label(MEDIA_REASON_LABELS, m.reason)}</span>
                        <span className="text-ivory/60">
                          {m.agentName ?? "unknown sender"} · {m.agencyName ?? "—"}
                          {m.propertyId ? (
                            <> · <Link href={`/admin/properties/${m.propertyId}`} className="link-underline text-ivory">{m.propertyTitle ?? "draft"}</Link></>
                          ) : m.sessionStatus ? ` · session ${m.sessionStatus}` : ""}
                          {m.failedStage ? ` · failed at ${m.failedStage}` : ""}
                        </span>
                        <span className="label text-ivory/40">
                          tries {m.attempts.download}/{m.attempts.validation}/{m.attempts.attach} · {dateTime(m.updatedAt)}
                        </span>
                        <span>{m.retryable ? <RetryMediaButton mediaId={m.mediaId} /> : <span className="label text-ivory/30">no action</span>}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}

          <section>
            <h2 className="label text-ivory/40">Submissions without a clean draft ({submissions.data.length})</h2>
            {submissions.data.length === 0 ? (
              <EmptyState>None.</EmptyState>
            ) : (
              <ul className="mt-4 divide-y divide-ivory/10 border-y border-ivory/10">
                {submissions.data.map((s) => (
                  <li key={s.sessionId} className="grid gap-3 py-3 text-[0.85rem] lg:grid-cols-[12rem_1fr_12rem]">
                    <span className="text-ivory/85">
                      {s.validationStatus ?? s.sessionStatus}
                      {s.conflictCount > 0 ? ` · ${s.conflictCount} conflict(s)` : ""}
                    </span>
                    <span className="text-ivory/60">
                      {s.agentName ?? "—"} · {s.agencyName ?? "—"} · session {s.sessionStatus}
                      {s.lastError ? ` · ${s.lastError}` : ""}
                      {s.issues.length > 0 && (
                        <span className="mt-1 block text-ivory/45">
                          {s.issues.slice(0, 4).map((i) => `${i.field ? `${i.field}: ` : ""}${i.code ?? i.message}`).join(" · ")}
                          {s.issues.length > 4 ? ` · +${s.issues.length - 4}` : ""}
                        </span>
                      )}
                      {s.propertyId && (
                        <> · <Link href={`/admin/properties/${s.propertyId}`} className="link-underline text-ivory">draft</Link></>
                      )}
                    </span>
                    <span className="label text-ivory/40">{dateTime(s.lastMessageAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
