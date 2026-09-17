"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/* Switches a listing between scheduled viewings, by-appointment and closed.
   'appointment_only' makes the booking panel collect an enquiry instead of
   offering slots, which is how a plot of land behaves. */

const MODES = [
  { value: "standard", label: "Scheduled slots" },
  { value: "appointment_only", label: "By appointment" },
  { value: "unavailable", label: "No viewings" },
];

export function PropertyViewingSettings({
  slug, mode, duration,
}: { slug: string; mode: string; duration: number }) {
  const router = useRouter();
  const [value, setValue] = useState(mode);
  const [busy, setBusy] = useState(false);

  async function change(next: string) {
    setValue(next);
    setBusy(true);
    try {
      await fetch("/api/admin/availability", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "property", propertySlug: slug, mode: next, durationMinutes: duration }),
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <select value={value} disabled={busy} onChange={(e) => change(e.target.value)} className="admin-select">
      {MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
    </select>
  );
}
