"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { BookingActions } from "./BookingActions";
import { StatusPill } from "./pieces";
import { businessToday, formatDateShort, formatTime24 } from "@/lib/booking/time";
import { BOOKING_STATUSES, STATUS_LABELS, type Booking, type BookingStatus } from "@/lib/booking/types";

/* ----------------------------------------------------------------------------
   Booking list with filters, a detail drawer, and manual entry for viewings
   taken over the phone.
---------------------------------------------------------------------------- */

type Range = "upcoming" | "today" | "past" | "all";

export function BookingsBrowser({
  bookings, properties, initialReference, startCreating,
}: {
  bookings: Booking[];
  properties: { slug: string; title: string; viewingMode: string }[];
  initialReference: string | null;
  startCreating: boolean;
}) {
  const [range, setRange] = useState<Range>("upcoming");
  const [status, setStatus] = useState<BookingStatus | "all">("all");
  const [property, setProperty] = useState("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(initialReference);
  const [creating, setCreating] = useState(startCreating);

  const today = businessToday();

  const filtered = useMemo(() => {
    return bookings.filter((b) => {
      if (range === "upcoming" && b.date < today) return false;
      if (range === "today" && b.date !== today) return false;
      if (range === "past" && b.date >= today) return false;
      if (status !== "all" && b.status !== status) return false;
      if (property !== "all" && b.propertySlug !== property) return false;
      if (query) {
        const hay = `${b.customerName} ${b.customerEmail} ${b.customerPhone} ${b.reference} ${b.propertyTitle}`.toLowerCase();
        if (!hay.includes(query.toLowerCase())) return false;
      }
      return true;
    });
  }, [bookings, range, status, property, query, today]);

  const current = bookings.find((b) => b.reference === selected) ?? null;

  return (
    <div className="mt-8">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          value={range}
          onChange={(v) => setRange(v as Range)}
          options={[["upcoming", "Upcoming"], ["today", "Today"], ["past", "Past"], ["all", "All"]]}
        />

        <select value={status} onChange={(e) => setStatus(e.target.value as BookingStatus | "all")} className="admin-select">
          <option value="all">All statuses</option>
          {BOOKING_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
        </select>

        <select value={property} onChange={(e) => setProperty(e.target.value)} className="admin-select">
          <option value="all">All properties</option>
          {properties.map((p) => <option key={p.slug} value={p.slug}>{p.title}</option>)}
        </select>

        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name, phone, reference"
          className="admin-input min-w-[14rem] flex-1"
        />

        <button
          type="button"
          onClick={() => setCreating(true)}
          className="label border border-champagne/60 px-4 py-2.5 text-champagne transition-colors duration-300 hover:bg-champagne hover:text-black"
        >
          Add a viewing
        </button>
      </div>

      {creating && (
        <ManualBooking
          properties={properties.filter((p) => p.viewingMode === "standard")}
          onClose={() => setCreating(false)}
        />
      )}

      <div className="mt-6 overflow-x-auto">
        <table className="w-full min-w-[52rem] border-collapse text-left">
          <thead>
            <tr className="border-b border-ivory/15">
              {["Date", "Time", "Customer", "Property", "Contact", "Status"].map((h) => (
                <th key={h} className="label py-3 pr-4 font-normal text-ivory/35">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={6} className="label py-10 text-ivory/30">No bookings match these filters.</td></tr>
            )}
            {filtered.map((b) => (
              <tr
                key={b.id}
                onClick={() => setSelected(b.reference)}
                className={`cursor-pointer border-b border-ivory/8 transition-colors duration-200 hover:bg-ivory/[0.03] ${
                  selected === b.reference ? "bg-ivory/[0.05]" : ""
                }`}
              >
                <td className="label py-3.5 pr-4 text-ivory/70">{formatDateShort(b.date)}</td>
                <td className="label py-3.5 pr-4 text-champagne">{formatTime24(b.startTime)}</td>
                <td className="py-3.5 pr-4 text-[0.92rem] text-ivory">{b.customerName}</td>
                <td className="label py-3.5 pr-4 text-ivory/60">{b.propertyTitle}</td>
                <td className="label py-3.5 pr-4 text-ivory/45">{b.customerPhone}</td>
                <td className="py-3.5 pr-4"><StatusPill status={b.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {current && (
        <div className="fixed inset-0 z-[120] flex justify-end" role="dialog" aria-modal="true" aria-label={`Booking ${current.reference}`}>
          <button type="button" aria-label="Close" onClick={() => setSelected(null)} className="absolute inset-0 bg-black/70" />
          <div className="relative w-full max-w-[36rem] overflow-y-auto border-l border-ivory/12 bg-ink p-7 booking-panel-in">
            <div className="flex items-start justify-between gap-6">
              <div>
                <p className="label text-champagne">{current.reference}</p>
                <h2 className="mt-2 font-display text-[1.7rem] leading-none">{current.customerName}</h2>
              </div>
              <button type="button" onClick={() => setSelected(null)} aria-label="Close" className="label text-ivory/40 hover:text-ivory">
                Close ✕
              </button>
            </div>
            <div className="mt-7">
              <BookingActions booking={current} onDone={() => setSelected(null)} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Segmented({
  value, onChange, options,
}: { value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <div className="flex border border-ivory/12">
      {options.map(([v, label]) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className={`label px-4 py-2.5 transition-colors duration-300 ${
            value === v ? "bg-espresso/70 text-champagne" : "text-ivory/50 hover:text-ivory"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function ManualBooking({
  properties, onClose,
}: { properties: { slug: string; title: string }[]; onClose: () => void }) {
  const router = useRouter();
  const [form, setForm] = useState({
    propertySlug: properties[0]?.slug ?? "", date: "", startTime: "", name: "", phone: "", email: "", message: "",
  });
  const [slots, setSlots] = useState<{ date: string; start: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadSlots(slug: string) {
    const res = await fetch(`/api/availability?property=${slug}`, { cache: "no-store" });
    const body = await res.json();
    setSlots((body.days ?? []).flatMap((d: { date: string; slots: { start: string }[] }) =>
      d.slots.map((s) => ({ date: d.date, start: s.start }))));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/bookings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) { setError(body.message ?? "Could not create the booking."); return; }
      onClose();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-6 border border-ivory/12 bg-ink p-6">
      <div className="flex items-center justify-between">
        <p className="label text-champagne">New viewing</p>
        <button type="button" onClick={onClose} className="label text-ivory/40 hover:text-ivory">Close ✕</button>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="label text-ivory/35">Property</span>
          <select
            value={form.propertySlug}
            onChange={(e) => { setForm({ ...form, propertySlug: e.target.value, date: "", startTime: "" }); void loadSlots(e.target.value); }}
            className="admin-input mt-2 w-full"
          >
            {properties.map((p) => <option key={p.slug} value={p.slug}>{p.title}</option>)}
          </select>
        </label>

        <label className="block">
          <span className="label text-ivory/35">Open slot</span>
          <select
            value={form.date && form.startTime ? `${form.date}|${form.startTime}` : ""}
            onFocus={() => { if (!slots.length && form.propertySlug) void loadSlots(form.propertySlug); }}
            onChange={(e) => {
              const [date, startTime] = e.target.value.split("|");
              setForm({ ...form, date, startTime });
            }}
            className="admin-input mt-2 w-full"
          >
            <option value="">Choose a time…</option>
            {slots.map((s) => (
              <option key={`${s.date}-${s.start}`} value={`${s.date}|${s.start}`}>
                {formatDateShort(s.date)} · {s.start}
              </option>
            ))}
          </select>
        </label>

        <Input label="Customer name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} required />
        <Input label="Phone" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} required />
        <Input label="Email (optional)" value={form.email} onChange={(v) => setForm({ ...form, email: v })} />
        <Input label="Note" value={form.message} onChange={(v) => setForm({ ...form, message: v })} />
      </div>

      {error && <p role="alert" className="label mt-4 border border-champagne/40 bg-champagne/5 px-3 py-2 text-champagne">{error}</p>}

      <button
        type="submit"
        disabled={busy || !form.date || !form.startTime}
        className="label mt-6 bg-ivory px-5 py-3 text-ink transition-colors duration-300 hover:bg-champagne disabled:opacity-40"
      >
        {busy ? "Creating…" : "Create booking"}
      </button>
    </form>
  );
}

function Input({
  label, value, onChange, required,
}: { label: string; value: string; onChange: (v: string) => void; required?: boolean }) {
  return (
    <label className="block">
      <span className="label text-ivory/35">{label}</span>
      <input value={value} required={required} onChange={(e) => onChange(e.target.value)} className="admin-input mt-2 w-full" />
    </label>
  );
}
