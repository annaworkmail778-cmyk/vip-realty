"use client";

import { useState } from "react";
import { formatDateLong, formatTime12 } from "@/lib/booking/time";

/* ----------------------------------------------------------------------------
   The customer's own view of their booking: confirm, or cancel and release
   the slot. Both actions post the token back, so the page works for someone
   who has never signed in to anything.
---------------------------------------------------------------------------- */

interface View {
  reference: string;
  propertyTitle: string;
  propertySlug: string;
  propertyAddress: string;
  date: string;
  startTime: string;
  endTime: string;
  status: string;
  confirmationStatus: string;
  customerName: string;
}

export function ManageViewing({ booking, token }: { booking: View; token: string }) {
  const [status, setStatus] = useState(booking.status);
  const [confirmation, setConfirmation] = useState(booking.confirmationStatus);
  const [busy, setBusy] = useState<"confirm" | "cancel" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [askCancel, setAskCancel] = useState(false);

  const act = async (action: "confirm" | "cancel") => {
    setBusy(action);
    setError(null);
    try {
      const res = await fetch(`/api/bookings/${booking.reference}/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        setError(body.message ?? "Something went wrong. Please call us instead.");
        return;
      }
      setStatus(body.status ?? status);
      setConfirmation(body.confirmationStatus ?? (action === "cancel" ? "declined" : "confirmed"));
      setAskCancel(false);
    } catch {
      setError("We could not reach the booking service. Please call us instead.");
    } finally {
      setBusy(null);
    }
  };

  const cancelled = status === "cancelled";
  const confirmed = confirmation === "confirmed";

  const headline = cancelled
    ? "Your viewing has been cancelled."
    : confirmed
      ? "Your viewing is confirmed."
      : "Your VIP Realty viewing is coming up.";

  return (
    <div>
      <h1 className="display-md mt-6 max-w-[18ch]">{headline}</h1>

      {!cancelled && !confirmed && (
        <p className="mt-5 max-w-[46ch] text-[0.98rem] leading-relaxed text-ivory/65">
          {booking.customerName.split(" ")[0]}, please confirm you are still coming so we can have the
          property open and an agent waiting for you.
        </p>
      )}

      <dl className="mt-10 border-t border-ivory/12">
        <Row label="Property" value={booking.propertyTitle} />
        <Row label="Date" value={formatDateLong(booking.date)} />
        <Row label="Time" value={`${formatTime12(booking.startTime)} – ${formatTime12(booking.endTime)} · Yerevan`} />
        <Row label="Location" value={booking.propertyAddress} />
        <Row label="Booking" value={booking.reference} accent />
        <Row label="Status" value={cancelled ? "Cancelled" : confirmed ? "Confirmed by you" : "Awaiting your confirmation"} />
      </dl>

      {error && <p role="alert" className="label mt-6 border border-champagne/40 bg-champagne/5 px-4 py-3 text-champagne">{error}</p>}

      {cancelled ? (
        <p className="mt-8 max-w-[44ch] text-[0.95rem] leading-relaxed text-ivory/55">
          The time has been released for other clients. If this was a mistake, call us and we will find
          you another.
        </p>
      ) : (
        <div className="mt-10 flex flex-col gap-3 sm:flex-row">
          {!confirmed && (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => act("confirm")}
              className="label-lg group flex flex-1 items-center justify-center gap-3 bg-champagne px-6 py-4 text-black transition-colors duration-500 hover:bg-ivory disabled:opacity-50"
            >
              {busy === "confirm" ? "Confirming…" : "Confirm my viewing"}
            </button>
          )}

          <a
            href={`/api/bookings/${booking.reference}/calendar?token=${token}`}
            className="label-lg flex flex-1 items-center justify-center border border-ivory/25 px-6 py-4 text-ivory/80 transition-colors duration-500 hover:border-champagne hover:text-champagne"
          >
            Add to calendar
          </a>
        </div>
      )}

      {!cancelled && (
        askCancel ? (
          <div className="mt-6 border border-ivory/15 p-6">
            <p className="text-[0.92rem] text-ivory/75">Cancel this viewing and release the time?</p>
            <div className="mt-5 flex gap-4">
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => act("cancel")}
                className="label border border-champagne px-5 py-3 text-champagne transition-colors duration-300 hover:bg-champagne hover:text-black disabled:opacity-50"
              >
                {busy === "cancel" ? "Cancelling…" : "Yes, cancel"}
              </button>
              <button type="button" onClick={() => setAskCancel(false)} className="label px-4 py-3 text-ivory/50 hover:text-ivory">
                Keep my viewing
              </button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setAskCancel(true)} className="label mt-6 text-ivory/35 transition-colors duration-300 hover:text-ivory/70">
            Cancel viewing
          </button>
        )
      )}
    </div>
  );
}

function Row({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-8 gap-y-1 border-b border-ivory/12 py-4">
      <dt className="label text-ivory/40">{label}</dt>
      <dd className={`text-[0.98rem] ${accent ? "text-champagne" : "text-ivory"}`}>{value}</dd>
    </div>
  );
}
