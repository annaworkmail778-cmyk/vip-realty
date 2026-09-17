"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { businessToday, formatDateShort, WEEKDAY_NAMES } from "@/lib/booking/time";
import type { Blackout, DateOverride, ScheduleRule } from "@/lib/booking/types";

/* ----------------------------------------------------------------------------
   Availability management.

   Three layers, applied in this order:
     1. Recurring weekly hours — the agency default, or a property's own.
     2. Per-date slots — replace the recurring hours for one date entirely.
     3. Blocked time — subtracted last, for a holiday or a single hour.

   A property with no rules of its own inherits the agency hours, which is what
   makes "Property A 10–18, Property B 12–16" a two-row change rather than a
   rewrite.
---------------------------------------------------------------------------- */

interface Props {
  scope: string | null;
  properties: { slug: string; title: string; viewingMode: string; duration: number }[];
  rules: ScheduleRule[];
  blackouts: Blackout[];
  overrides: DateOverride[];
}

export function AvailabilityEditor({ scope, properties, rules, blackouts, overrides }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const post = async (payload: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/availability", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ propertySlug: scope, ...payload }),
      });
      if (!res.ok) { setError("That change was rejected. Check the times and try again."); return false; }
      router.refresh();
      return true;
    } finally {
      setBusy(false);
    }
  };

  const scopeLabel = scope ? properties.find((p) => p.slug === scope)?.title ?? scope : "Agency default";

  return (
    <div className="mt-8">
      <div className="flex flex-wrap items-center gap-3">
        <label className="label text-ivory/35">Editing</label>
        <select
          value={scope ?? "agency"}
          onChange={(e) => router.push(`/admin/availability?property=${e.target.value}`)}
          className="admin-select"
        >
          <option value="agency">Agency default (all properties)</option>
          {properties.map((p) => <option key={p.slug} value={p.slug}>{p.title}</option>)}
        </select>
        {scope && (
          <p className="label max-w-[46ch] text-ivory/40">
            {rules.length === 0
              ? "Inheriting the agency hours. Adding any rule here makes this property own its whole week."
              : "This property uses only the hours below. Days left closed stay closed, whatever the agency default says."}
          </p>
        )}
      </div>

      {error && <p role="alert" className="label mt-5 border border-champagne/40 bg-champagne/5 px-4 py-3 text-champagne">{error}</p>}

      <section className="mt-10">
        <h2 className="label text-champagne">Recurring hours — {scopeLabel}</h2>
        <div className="mt-5 space-y-px">
          {WEEKDAY_NAMES.map((_, index) => {
            const dow = (index + 1) % 7; // Monday first, Sunday last
            return (
              <WeekdayRow
                key={dow}
                weekday={dow}
                rules={rules.filter((r) => r.weekday === dow)}
                busy={busy}
                onSave={(rule) => post({ kind: "rule", ...rule })}
                onDelete={(id) => post({ kind: "rule", action: "delete", id })}
              />
            );
          })}
        </div>
      </section>

      <div className="mt-12 grid gap-12 xl:grid-cols-2">
        <section>
          <h2 className="label text-champagne">Blocked time</h2>
          <p className="label mt-2 text-ivory/35">
            Removes slots. Leave the times empty to block the whole day.
          </p>
          <BlackoutForm busy={busy} onAdd={(b) => post({ kind: "blackout", ...b })} />
          <ul className="mt-6">
            {blackouts.length === 0 && <li className="label py-4 text-ivory/25">Nothing blocked.</li>}
            {blackouts.map((b) => (
              <li key={b.id} className="flex items-center justify-between gap-4 border-b border-ivory/10 py-3">
                <div>
                  <p className="text-[0.9rem] text-ivory">{formatDateShort(b.date)}
                    <span className="label ml-3 text-ivory/45">
                      {b.startTime ? `${b.startTime}–${b.endTime ?? "end"}` : "All day"}
                    </span>
                  </p>
                  <p className="label mt-1 text-ivory/30">
                    {b.propertySlug ?? "All properties"}{b.reason ? ` · ${b.reason}` : ""}
                  </p>
                </div>
                <button type="button" disabled={busy} onClick={() => post({ kind: "blackout", action: "delete", id: b.id })} className="label text-ivory/35 hover:text-champagne">
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h2 className="label text-champagne">One-off dates</h2>
          <p className="label mt-2 text-ivory/35">
            Replaces the recurring hours for that date. Use it to open a Sunday.
          </p>
          <OverrideForm busy={busy} onAdd={(o) => post({ kind: "override", ...o })} />
          <ul className="mt-6">
            {overrides.length === 0 && <li className="label py-4 text-ivory/25">No one-off dates.</li>}
            {overrides.map((o) => (
              <li key={o.id} className="flex items-center justify-between gap-4 border-b border-ivory/10 py-3">
                <div>
                  <p className="text-[0.9rem] text-ivory">
                    {formatDateShort(o.date)}
                    <span className="label ml-3 text-champagne">{o.startTime}–{o.endTime}</span>
                  </p>
                  <p className="label mt-1 text-ivory/30">
                    {o.propertySlug ?? "All properties"} · {o.isAvailable ? "Open" : "Closed"}
                  </p>
                </div>
                <button type="button" disabled={busy} onClick={() => post({ kind: "override", action: "delete", id: o.id })} className="label text-ivory/35 hover:text-champagne">
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

function WeekdayRow({
  weekday, rules, busy, onSave, onDelete,
}: {
  weekday: number;
  rules: ScheduleRule[];
  busy: boolean;
  onSave: (r: { weekday: number; startTime: string; endTime: string; slotMinutes: number }) => Promise<boolean>;
  onDelete: (id: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [start, setStart] = useState("10:00");
  const [end, setEnd] = useState("19:00");
  const [slot, setSlot] = useState(90);

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-ivory/10 py-3.5">
      <span className="label w-28 shrink-0 text-ivory/60">{WEEKDAY_NAMES[weekday]}</span>

      <div className="flex flex-1 flex-wrap items-center gap-3">
        {rules.length === 0 && !adding && <span className="label text-ivory/25">Closed</span>}
        {rules.map((r) => (
          <span key={r.id} className="label flex items-center gap-3 border border-ivory/15 px-3 py-2 text-ivory/80">
            {r.startTime}–{r.endTime}
            <span className="text-ivory/35">{r.slotMinutes}m</span>
            <button type="button" disabled={busy} onClick={() => onDelete(r.id)} className="text-ivory/35 hover:text-champagne" aria-label="Remove">✕</button>
          </span>
        ))}

        {adding ? (
          <span className="flex flex-wrap items-center gap-2">
            <input type="time" value={start} onChange={(e) => setStart(e.target.value)} className="admin-input" />
            <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} className="admin-input" />
            <select value={slot} onChange={(e) => setSlot(Number(e.target.value))} className="admin-select">
              {[30, 45, 60, 90, 120].map((m) => <option key={m} value={m}>{m} min</option>)}
            </select>
            <button
              type="button"
              disabled={busy}
              onClick={async () => { if (await onSave({ weekday, startTime: start, endTime: end, slotMinutes: slot })) setAdding(false); }}
              className="label bg-ivory px-3 py-2 text-ink hover:bg-champagne"
            >
              Save
            </button>
            <button type="button" onClick={() => setAdding(false)} className="label px-2 text-ivory/40 hover:text-ivory">Cancel</button>
          </span>
        ) : (
          <button type="button" onClick={() => setAdding(true)} className="label text-ivory/35 transition-colors hover:text-champagne">
            + Add hours
          </button>
        )}
      </div>
    </div>
  );
}

function BlackoutForm({
  busy, onAdd,
}: { busy: boolean; onAdd: (b: Record<string, unknown>) => Promise<boolean> }) {
  const [date, setDate] = useState(businessToday());
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [reason, setReason] = useState("");

  return (
    <div className="mt-5 flex flex-wrap items-end gap-2">
      <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="admin-input" />
      <input type="time" value={start} onChange={(e) => setStart(e.target.value)} className="admin-input" aria-label="From" />
      <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} className="admin-input" aria-label="To" />
      <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason" className="admin-input" />
      <button
        type="button"
        disabled={busy || !date}
        onClick={async () => { if (await onAdd({ date, startTime: start || null, endTime: end || null, reason })) { setStart(""); setEnd(""); setReason(""); } }}
        className="label border border-champagne/60 px-4 py-2.5 text-champagne transition-colors hover:bg-champagne hover:text-black disabled:opacity-40"
      >
        Block
      </button>
    </div>
  );
}

function OverrideForm({
  busy, onAdd,
}: { busy: boolean; onAdd: (o: Record<string, unknown>) => Promise<boolean> }) {
  const [date, setDate] = useState(businessToday());
  const [start, setStart] = useState("10:00");
  const [end, setEnd] = useState("11:30");

  return (
    <div className="mt-5 flex flex-wrap items-end gap-2">
      <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="admin-input" />
      <input type="time" value={start} onChange={(e) => setStart(e.target.value)} className="admin-input" aria-label="Slot start" />
      <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} className="admin-input" aria-label="Slot end" />
      <button
        type="button"
        disabled={busy}
        onClick={() => onAdd({ date, startTime: start, endTime: end, isAvailable: true })}
        className="label border border-ivory/25 px-4 py-2.5 text-ivory/80 transition-colors hover:border-champagne hover:text-champagne disabled:opacity-40"
      >
        Add slot
      </button>
    </div>
  );
}
