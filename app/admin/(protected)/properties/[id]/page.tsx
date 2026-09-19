import Link from "next/link";
import { notFound } from "next/navigation";
import { DataNotice, ListingStatusPill, PageHeader, ReviewStatusPill } from "@/components/admin/pieces";
import { ReviewActions } from "@/components/admin/ReviewActions";
import { BLOCKER_LABELS, MEDIA_REASON_LABELS, WARNING_LABELS, label } from "@/lib/admin/labels";
import { adminMediaUrl, getReviewDetail } from "@/lib/admin/properties";

export const dynamic = "force-dynamic";

const dateTime = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat("en-GB", {
        day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Yerevan",
      }).format(new Date(iso))
    : "—";

const show = (v: string | number | boolean | null | undefined) =>
  v === null || v === undefined || v === "" ? <span className="text-ivory/30">—</span> : String(v);

const value = (v: unknown) =>
  v === null || v === undefined ? <span className="text-ivory/30">—</span> : Array.isArray(v) ? v.join(", ") : String(v);

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="label text-ivory/40">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Rows({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="divide-y divide-ivory/10 border-y border-ivory/10">
      {rows.map(([k, v]) => (
        <div key={k} className="grid gap-2 py-3 sm:grid-cols-[12rem_1fr]">
          <dt className="label text-ivory/40">{k}</dt>
          <dd className="break-words text-[0.9rem] text-ivory/85">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/* Review detail: the draft, where every value came from, and the actions the database allows. */
export default async function AdminPropertyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getReviewDetail(id);

  if (!result.ok) {
    if (result.reason === "not_found") notFound();
    return (
      <div>
        <PageHeader title="Listing" />
        <DataNotice reason={result.reason} />
      </div>
    );
  }

  const p = result.data;
  const price = p.price !== null && p.currency
    ? `${new Intl.NumberFormat("en-US", { style: "currency", currency: p.currency, maximumFractionDigits: 0 }).format(p.price)}${p.pricePeriod ? ` / ${p.pricePeriod}` : ""}`
    : null;
  const reviewable = p.agencyName !== null;

  return (
    <div>
      <p className="label">
        <Link href="/admin/properties" className="link-underline text-ivory/45 hover:text-ivory">← Listings</Link>
      </p>
      <div className="mt-4">
        <PageHeader title={p.title ?? "Untitled draft"} subtitle={p.slug}>
          <ListingStatusPill status={p.listingStatus} />
          <ReviewStatusPill status={p.reviewStatus} />
          {p.listingStatus === "published" && (
            <Link href={`/properties/${p.slug}`} target="_blank" className="label link-underline text-champagne">
              View on website ↗
            </Link>
          )}
        </PageHeader>
      </div>

      <div className="mt-8 grid gap-10 xl:grid-cols-[1fr_26rem]">
        <div className="space-y-10">
          <Section title="Publication check (database)">
            {p.listingStatus === "published" ? (
              <p className="text-[0.9rem] text-champagne">Live on the website since {dateTime(p.publishedAt)}.</p>
            ) : p.publication.publishable ? (
              <p className="text-[0.9rem] text-champagne">All publication requirements are met.</p>
            ) : (
              <ul className="space-y-1.5 text-[0.9rem] text-ivory/85">
                {p.publication.blockers.map((b) => <li key={b}>• {label(BLOCKER_LABELS, b)}</li>)}
              </ul>
            )}
            {p.publication.warnings.length > 0 && (
              <ul className="mt-3 space-y-1 text-[0.85rem] text-ivory/50">
                {p.publication.warnings.map((w) => <li key={w}>Note: {label(WARNING_LABELS, w)}</li>)}
              </ul>
            )}
          </Section>

          <Section title="Listing">
            <Rows rows={[
              ["Intent", show(p.intent)],
              ["Property type", show(p.propertyType)],
              ["Price", show(price)],
              ["Price negotiable", show(p.priceNegotiable === null ? null : p.priceNegotiable ? "Yes" : "No")],
              ["Location", show([p.district, p.city, p.country].filter(Boolean).join(", ") || null)],
              ["Address (private)", show(p.address)],
              ["Area", show(p.areaSqm !== null ? `${p.areaSqm} m²` : null)],
              ["Land area", show(p.landAreaSqm !== null ? `${p.landAreaSqm} m²` : null)],
              ["Rooms · bedrooms · bathrooms", show([p.rooms, p.bedrooms, p.bathrooms].map((x) => x ?? "—").join(" · "))],
              ["Floor", show(p.floor !== null ? (p.totalFloors !== null ? `${p.floor} of ${p.totalFloors}` : p.floor) : null)],
              ["Year built", show(p.yearBuilt)],
              ["Features", show(p.features.length ? p.features.join(", ") : null)],
            ]} />
            <p className="mt-5 whitespace-pre-line text-[0.9rem] leading-relaxed text-ivory/75">
              {p.description ?? <span className="text-ivory/30">No description.</span>}
            </p>
          </Section>

          <Section title="Extraction">
            {!p.extraction ? (
              <p className="label text-ivory/30">{p.source === "whatsapp" ? "No extraction linked." : "Not created from WhatsApp."}</p>
            ) : (
              <>
                <Rows rows={[
                  ["Result", show(p.extraction.validationStatus)],
                  ["Attempt", show(p.extraction.attemptNumber)],
                  ["Model · prompt", show(`${p.extraction.model ?? "—"} · ${p.extraction.promptVersion ?? "—"}`)],
                  ["Extracted", dateTime(p.extraction.createdAt)],
                  ["Extraction id", <code key="e" className="text-ivory/60">{p.extraction.id}</code>],
                ]} />
                {p.extraction.issues.length > 0 && (
                  <ul className="mt-4 space-y-1 text-[0.85rem] text-ivory/70">
                    {p.extraction.issues.map((i, n) => (
                      <li key={n}>[{i.severity}] {i.field ? `${i.field}: ` : ""}{i.message ?? i.code}</li>
                    ))}
                  </ul>
                )}
                {p.extraction.conflicts.length > 0 && (
                  <div className="mt-4 border border-champagne/30 p-4">
                    <p className="label text-champagne">Conflicts</p>
                    <ul className="mt-2 space-y-1 text-[0.85rem] text-ivory/80">
                      {p.extraction.conflicts.map((c, n) => (
                        <li key={n}>
                          {c.field}: {c.values.map(String).join(" vs ")} — {c.resolution ?? "unresolved"} (messages {c.sourceMessages.join(", ") || "—"})
                          {c.note ? ` · ${c.note}` : ""}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <div className="mt-5 overflow-x-auto">
                  <table className="w-full min-w-[40rem] border-collapse text-left">
                    <thead>
                      <tr className="border-b border-ivory/15">
                        {["Field", "Value", "Status", "Msg", "Evidence"].map((h) => (
                          <th key={h} className="label py-2 pr-3 font-normal text-ivory/35">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {p.extraction.fields.filter((f) => f.status !== "unknown").map((f) => (
                        <tr key={f.name} className="border-b border-ivory/10 align-top">
                          <td className="label py-2 pr-3 text-ivory/60">{f.name}</td>
                          <td className="py-2 pr-3 text-[0.85rem] text-ivory/85">{value(f.value)}</td>
                          <td className="label py-2 pr-3 text-ivory/50">{f.status}</td>
                          <td className="label py-2 pr-3 text-ivory/50">{f.sourceMessages.join(", ") || "—"}</td>
                          <td className="py-2 pr-3 text-[0.85rem] italic text-ivory/60">{f.evidence ? `“${f.evidence}”` : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {p.extraction.notes.length > 0 && (
                  <ul className="mt-3 space-y-1 text-[0.85rem] text-ivory/50">
                    {p.extraction.notes.map((n, i) => <li key={i}>Note: {n}</li>)}
                  </ul>
                )}
              </>
            )}
          </Section>

          {p.messages.length > 0 && (
            <Section title="Source messages (WhatsApp submission)">
              <ol className="divide-y divide-ivory/10 border-y border-ivory/10">
                {p.messages.map((m) => (
                  <li key={m.id} className="grid gap-2 py-3 sm:grid-cols-[4rem_7rem_1fr]">
                    <span className="label text-ivory/40">#{m.seq}</span>
                    <span className="label text-ivory/40">{m.type} · {dateTime(m.sentAt)}</span>
                    <span className="whitespace-pre-line text-[0.88rem] text-ivory/80">{m.body ?? <span className="text-ivory/30">(no text)</span>}</span>
                  </li>
                ))}
              </ol>
            </Section>
          )}

          {p.media.length > 0 && (
            <Section title="WhatsApp media">
              <ul className="divide-y divide-ivory/10 border-y border-ivory/10">
                {p.media.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center gap-4 py-3 text-[0.85rem]">
                    {m.previewable ? (
                      // eslint-disable-next-line @next/next/no-img-element -- authenticated admin route, not optimisable
                      <img src={adminMediaUrl(m.id)} alt="" className="h-12 w-16 object-cover" loading="lazy" />
                    ) : (
                      <span className="flex h-12 w-16 items-center justify-center border border-ivory/10 text-ivory/25">—</span>
                    )}
                    <span className="label text-ivory/50">{m.seq !== null ? `msg #${m.seq}` : "msg —"}</span>
                    <span className="text-ivory/85">{m.status}</span>
                    <span className="text-ivory/50">{m.reason ? label(MEDIA_REASON_LABELS, m.reason) : ""}</span>
                    <span className="label text-ivory/35">{m.detectedMime ?? ""}{m.fileSize ? ` · ${Math.round(m.fileSize / 1024)} KB` : ""}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <Section title="Activity">
            {p.events.length === 0 ? (
              <p className="label text-ivory/30">No recorded activity.</p>
            ) : (
              <ul className="divide-y divide-ivory/10 border-y border-ivory/10">
                {p.events.map((e, i) => (
                  <li key={i} className="grid gap-2 py-2.5 sm:grid-cols-[10rem_16rem_1fr]">
                    <span className="label text-ivory/40">{dateTime(e.createdAt)}</span>
                    <span className="label text-ivory/70">{e.type}</span>
                    <span className="text-[0.8rem] text-ivory/50">
                      {["actor", "actor_kind", "from", "to", "reason", "blockers"]
                        .filter((k) => e.details[k] !== undefined)
                        .map((k) => `${k}: ${Array.isArray(e.details[k]) ? (e.details[k] as unknown[]).join(", ") : String(e.details[k])}`)
                        .join(" · ")}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>

        <div className="space-y-10">
          <Section title="Actions">
            <ReviewActions
              id={p.id}
              version={p.stateVersion}
              listingStatus={p.listingStatus}
              reviewStatus={p.reviewStatus}
              intent={p.intent}
              publishable={p.publication.publishable}
              reviewable={reviewable}
            />
          </Section>

          <Section title="Review">
            <Rows rows={[
              ["Review status", <ReviewStatusPill key="r" status={p.reviewStatus} />],
              ["Reason", show(p.reviewNote)],
              ["Reviewed", dateTime(p.reviewedAt)],
              ["Reviewer", show(p.reviewedBy)],
            ]} />
          </Section>

          <Section title={`Photos (${p.images.length})`}>
            {p.images.length === 0 ? (
              <p className="label text-ivory/30">No photos attached.</p>
            ) : (
              <ul className="grid grid-cols-2 gap-3">
                {p.images.map((img) => (
                  <li key={img.id} className="border border-ivory/10 bg-ink">
                    <div className="relative aspect-[4/3] overflow-hidden bg-black">
                      {/* Served by the authenticated admin route, never by a public draft URL. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={img.url} alt="" className="h-full w-full object-cover" loading="lazy" />
                    </div>
                    <p className="label px-3 py-2 text-ivory/50">#{img.sortOrder}{img.fromWhatsApp ? " · WhatsApp" : ""}</p>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Provenance">
            <Rows rows={[
              ["Source", show(p.source)],
              ["Agent", show(p.agentName ? `${p.agentName}${p.agentActive === false ? " (inactive)" : ""}` : null)],
              ["Agency", show(p.agencyName)],
              ["Submission session", p.sessionId ? <code key="s" className="text-ivory/60">{p.sessionId}</code> : show(null)],
              ["Session status", show(p.sessionStatus)],
              ["Created", dateTime(p.createdAt)],
              ["Status changed", dateTime(p.listingStatusChangedAt)],
              ["Listing id", <code key="i" className="text-ivory/60">{p.id}</code>],
            ]} />
          </Section>
        </div>
      </div>
    </div>
  );
}
