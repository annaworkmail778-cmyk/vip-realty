"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { BookingSettings } from "@/lib/booking/types";

export function SettingsForm({ settings }: { settings: BookingSettings }) {
  const router = useRouter();
  const [form, setForm] = useState(settings);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setSaved(false);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      if (res.ok) { setSaved(true); router.refresh(); }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-6 space-y-6">
      <Number
        label="Minimum notice"
        suffix="minutes"
        hint="How soon before a slot a customer may still book it."
        value={form.minLeadMinutes}
        onChange={(v) => setForm({ ...form, minLeadMinutes: v })}
      />
      <Number
        label="Book up to"
        suffix="days ahead"
        hint="How far into the future the calendar offers dates."
        value={form.maxDaysAhead}
        onChange={(v) => setForm({ ...form, maxDaysAhead: v })}
      />
      <Number
        label="Default viewing length"
        suffix="minutes"
        hint="Used when a new recurring rule does not say otherwise."
        value={form.defaultSlotMinutes}
        onChange={(v) => setForm({ ...form, defaultSlotMinutes: v })}
      />
      <Number
        label="Send reminder"
        suffix="hours before"
        hint="The scheduled job queues a customer reminder this far ahead."
        value={form.reminderHoursBefore}
        onChange={(v) => setForm({ ...form, reminderHoursBefore: v })}
      />

      <label className="flex cursor-pointer items-start gap-3 border-t border-ivory/10 pt-5">
        <input
          type="checkbox"
          checked={form.autoCancelUnconfirmed}
          onChange={(e) => setForm({ ...form, autoCancelUnconfirmed: e.target.checked })}
          className="mt-1 h-4 w-4 shrink-0 appearance-none border border-ivory/30 checked:border-champagne checked:bg-champagne"
        />
        <span>
          <span className="label text-ivory/70">Auto-cancel unconfirmed viewings</span>
          <span className="label mt-1.5 block max-w-[46ch] normal-case tracking-normal text-ivory/35">
            Off by default. An unconfirmed viewing stays booked and is marked &ldquo;never
            confirmed&rdquo; instead, so nobody is turned away by a rule nobody chose.
          </span>
        </span>
      </label>

      <div className="flex items-center gap-4 pt-2">
        <button type="submit" disabled={busy} className="label bg-ivory px-5 py-3 text-ink transition-colors hover:bg-champagne disabled:opacity-40">
          {busy ? "Saving…" : "Save settings"}
        </button>
        {saved && <span className="label text-champagne">Saved</span>}
      </div>
    </form>
  );
}

function Number({
  label, suffix, hint, value, onChange,
}: { label: string; suffix: string; hint: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="block border-t border-ivory/10 pt-5">
      <span className="label text-ivory/70">{label}</span>
      <span className="mt-2 flex items-center gap-3">
        <input
          type="number"
          value={value}
          onChange={(e) => onChange(globalThis.Number(e.target.value))}
          className="admin-input w-28"
        />
        <span className="label text-ivory/40">{suffix}</span>
      </span>
      <span className="label mt-2 block max-w-[46ch] normal-case tracking-normal text-ivory/35">{hint}</span>
    </label>
  );
}
