"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatDateLong, formatTime24 } from "@/lib/booking/time";
import { CONFIRMATION_LABELS, STATUS_LABELS, type Booking, type BookingStatus } from "@/lib/booking/types";

/* ----------------------------------------------------------------------------
   The detail view for one booking, and every admin action on it.

   Reschedule offers only slots the server says are open for that property, so
   an agent cannot move a customer onto a time another customer holds — the
   same rule the public flow obeys, enforced in the same place.
---------------------------------------------------------------------------- */

const ACTIONS: { status: BookingStatus; label: string }[] = [
  { status: "confirmed", label: "Confirm" },
  { status: "completed", label: "Mark completed" },
  { status: "no_show", label: "Mark no-show" },
  { status: "cancelled", label: "Cancel" },
];

export function BookingActions({ booking, onDone }: { booking: Booking; onDone?: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState(booking.internalNote ?? "");
  const [rescheduling, setRescheduling] = useState(false);
  const [slots, setSlots] = useState<{ date: string; start: string }[]>([]);
  const [pick, setPick] = useState<{ date: string; start: string } | null>(null);

  async function setStatus(status: BookingStatus) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/bookings/${booking.reference}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "status", status, note }),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) { setError(body.message ?? "Could not update."); return; }
      router.refresh();
      onDone?.();
    } finally {
      setBusy(false);
    }
  }

  async function loadSlots() {
    setRescheduling(true);
    const res = await fetch(`/api/availability?property=${booking.propertySlug}`, { cache: "no-store" });
    const body = await res.json();
    setSlots(
      (body.days ?? []).flatMap((d: { date: string; slots: { start: string }[] }) =>
        d.slots.map((s) => ({ date: d.date, start: s.start }))),
    );
  }

  async function reschedule() {
    if (!pick) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/bookings/${booking.reference}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "reschedule", date: pick.date, startTime: pick.start }),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) { setError(body.message ?? "Could not reschedule."); return; }
      setRescheduling(false);
      setPick(null);
      router.refresh();
      onDone?.();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
        <Field label="Customer" value={booking.customerName} />
        <Field label="Booking" value={booking.reference} accent />
        <Field label="Phone" value={booking.customerPhone} href={`tel:${booking.customerPhone.replace(/\s/g, "")}`} />
        <Field label="Email" value={booking.customerEmail} href={`mailto:${booking.customerEmail}`} />
        <Field label="Property" value={booking.propertyTitle} href={`/properties/${booking.propertySlug}`} />
        <Field label="Location" value={booking.propertyAddress ?? booking.propertyLocation} />
        <Field label="Date" value={formatDateLong(booking.date)} />
        <Field label="Time" value={`${formatTime24(booking.startTime)} – ${formatTime24(booking.endTime)} (Yerevan)`} />
        <Field label="Status" value={STATUS_LABELS[booking.status]} />
        <Field label="Customer confirmation" value={CONFIRMATION_LABELS[booking.confirmationStatus]} />
        <Field label="Booked via" value={booking.source} />
        <Field label="Consent to contact" value={booking.contactConsent ? "Yes" : "Not given"} />
      </dl>

      {booking.customerMessage && (
        <div className="mt-6 border-l border-champagne/40 pl-4">
          <p className="label text-ivory/35">Customer message</p>
          <p className="mt-2 text-[0.92rem] leading-relaxed text-ivory/75">{booking.customerMessage}</p>
        </div>
      )}

      <label className="mt-7 block">
        <span className="label text-ivory/35">Internal note</span>
        <textarea
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Not shown to the customer"
          className="mt-2 w-full resize-none border border-ivory/12 bg-black/40 px-3 py-2.5 text-[0.9rem] text-ivory outline-none transition-colors duration-300 placeholder:text-ivory/25 focus:border-champagne"
        />
      </label>

      {error && <p role="alert" className="label mt-4 border border-champagne/40 bg-champagne/5 px-3 py-2 text-champagne">{error}</p>}

      <div className="mt-6 flex flex-wrap gap-2">
        {ACTIONS.filter((a) => a.status !== booking.status).map((a) => (
          <button
            key={a.status}
            type="button"
            disabled={busy}
            onClick={() => setStatus(a.status)}
            className="label border border-ivory/20 px-4 py-2.5 text-ivory/75 transition-colors duration-300 hover:border-champagne hover:text-champagne disabled:opacity-40"
          >
            {a.label}
          </button>
        ))}
        <button
          type="button"
          disabled={busy}
          onClick={loadSlots}
          className="label border border-ivory/20 px-4 py-2.5 text-ivory/75 transition-colors duration-300 hover:border-champagne hover:text-champagne disabled:opacity-40"
        >
          Reschedule
        </button>
      </div>

      {rescheduling && (
        <div className="mt-6 border border-ivory/12 p-5">
          <p className="label text-ivory/40">Move to an open slot</p>
          {slots.length === 0 ? (
            <p className="label mt-4 text-ivory/30">No open slots for this property.</p>
          ) : (
            <div className="mt-4 max-h-56 overflow-y-auto">
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                {slots.slice(0, 60).map((s) => {
                  const active = pick?.date === s.date && pick?.start === s.start;
                  return (
                    <button
                      key={`${s.date}-${s.start}`}
                      type="button"
                      onClick={() => setPick(s)}
                      className={`label px-2 py-2.5 transition-colors duration-200 ${
                        active ? "bg-champagne text-black" : "border border-ivory/12 text-ivory/70 hover:border-champagne/60"
                      }`}
                    >
                      {s.date.slice(5)} · {s.start}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <div className="mt-5 flex gap-3">
            <button
              type="button"
              disabled={!pick || busy}
              onClick={reschedule}
              className="label bg-ivory px-4 py-2.5 text-ink transition-colors duration-300 hover:bg-champagne disabled:opacity-40"
            >
              Move booking
            </button>
            <button type="button" onClick={() => setRescheduling(false)} className="label px-3 py-2.5 text-ivory/45 hover:text-ivory">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, href, accent }: { label: string; value: string; href?: string; accent?: boolean }) {
  return (
    <div>
      <dt className="label text-ivory/35">{label}</dt>
      <dd className={`mt-1.5 text-[0.95rem] ${accent ? "text-champagne" : "text-ivory"}`}>
        {href ? <a href={href} className="link-underline">{value}</a> : value}
      </dd>
    </div>
  );
}
