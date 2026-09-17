"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { BookingCalendar } from "./BookingCalendar";
import type { AvailabilityResponse, ConfirmedBooking } from "./types";
import {
  addDays, businessToday, formatDateLong, formatTime12,
} from "@/lib/booking/time";
import type { Property } from "@/lib/properties";

/* ----------------------------------------------------------------------------
   Book a private viewing.

   A four-step flow — date, time, details, confirmation — presented as a side
   panel on desktop and a full-screen sheet on a phone. The property is fixed
   by whoever opened the panel, so the customer never picks it again.

   The slot list is re-fetched whenever a booking fails with a taken slot, so a
   customer who loses a race sees the truth immediately rather than a stale grid.
---------------------------------------------------------------------------- */

type Step = "when" | "details" | "done";

interface Props {
  property: Property;
  open: boolean;
  onClose: () => void;
}

export function BookingPanel({ property, open, onClose }: Props) {
  const [data, setData] = useState<AvailabilityResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // The displayed month is derived, not stored, until the visitor pages away
  // from it — which avoids an effect that would fight the derived value.
  const [monthOverride, setMonthOverride] = useState<string | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [time, setTime] = useState<string | null>(null);
  const [step, setStep] = useState<Step>("when");

  const [form, setForm] = useState({ name: "", phone: "", email: "", message: "", consent: false });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmed, setConfirmed] = useState<ConfirmedBooking | null>(null);
  const [cancelled, setCancelled] = useState(false);

  const panelRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const requested = useRef(false);

  const loadAvailability = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`/api/availability?property=${encodeURIComponent(property.slug)}`, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      setData(await res.json());
    } catch {
      setLoadError("We could not load available times. Please try again, or contact us directly.");
    } finally {
      setLoading(false);
    }
  }, [property.slug]);

  // Load once per opening. The work happens off the effect body so opening the
  // panel does not cascade renders.
  useEffect(() => {
    if (!open || requested.current) return;
    requested.current = true;
    void loadAvailability();
  }, [open, loadAvailability]);

  // Escape closes, and the page behind stops scrolling while the panel is up.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    headingRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  const availableDates = useMemo(
    () => new Set((data?.days ?? []).filter((d) => d.slots.length > 0).map((d) => d.date)),
    [data],
  );

  const slotsForDate = useMemo(
    () => (date ? data?.days.find((d) => d.date === date)?.slots ?? [] : []),
    [data, date],
  );

  const firstAvailable = useMemo(
    () => (data?.days ?? []).find((d) => d.slots.length > 0)?.date ?? null,
    [data],
  );

  // Open on the first month that actually has availability.
  const month = monthOverride
    ?? `${(firstAvailable ?? businessToday()).slice(0, 7)}-01`;

  const reset = () => {
    setDate(null); setTime(null); setStep("when"); setMonthOverride(null);
    setForm({ name: "", phone: "", email: "", message: "", consent: false });
    setFieldErrors({}); setSubmitError(null); setConfirmed(null); setCancelled(false);
  };

  const close = () => {
    requested.current = false;
    onClose();
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!date || !time || submitting) return;

    setSubmitting(true);
    setSubmitError(null);
    setFieldErrors({});

    try {
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ propertySlug: property.slug, date, startTime: time, ...form }),
      });
      const body = await res.json();

      if (!res.ok || !body.ok) {
        if (body.fields) setFieldErrors(body.fields);
        setSubmitError(body.message ?? "Something went wrong. Please try again.");
        // Someone else took the slot: go back and show what is actually free.
        if (body.error === "slot_taken" || body.error === "slot_unavailable") {
          setTime(null);
          setStep("when");
          await loadAvailability();
        }
        return;
      }

      setConfirmed(body.booking as ConfirmedBooking);
      setStep("done");
    } catch {
      setSubmitError("We could not reach the booking service. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function cancelBooking() {
    if (!confirmed) return;
    const res = await fetch(`/api/bookings/${confirmed.reference}/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: confirmed.manageToken }),
    });
    if (res.ok) {
      setCancelled(true);
      setData(null); // availability changed
    }
  }

  if (!open) return null;

  const appointmentOnly = data?.property.viewingMode === "appointment_only";

  return (
    <div className="fixed inset-0 z-[120]" role="dialog" aria-modal="true" aria-label="Book a private viewing">
      <button
        type="button"
        aria-label="Close booking panel"
        onClick={close}
        className="absolute inset-0 bg-black/70 backdrop-blur-[2px] animate-[fade_.4s_ease]"
      />

      <div
        ref={panelRef}
        className="absolute inset-0 flex flex-col overflow-y-auto bg-ink text-ivory sm:inset-y-0 sm:left-auto sm:right-0 sm:w-[min(34rem,100vw)] sm:border-l sm:border-ivory/12 booking-panel-in"
      >
        {/* property header */}
        <header className="relative shrink-0 overflow-hidden bg-black">
          <div className="relative h-40 sm:h-48">
            <Image
              src={property.media.wide}
              alt=""
              fill
              sizes="(max-width: 640px) 100vw, 34rem"
              className="object-cover opacity-70"
            />
            <div className="absolute inset-0 scrim-bottom" aria-hidden />
            <button
              type="button"
              onClick={close}
              aria-label="Close"
              className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center border border-ivory/25 bg-black/40 text-ivory transition-colors duration-300 hover:border-champagne hover:text-champagne"
            >
              ✕
            </button>
          </div>

          <div className="shell-wide relative -mt-12 pb-6">
            <p className="label text-champagne">Book a private viewing</p>
            <h2 ref={headingRef} tabIndex={-1} className="display-sm mt-2 outline-none">{property.name}</h2>
            <p className="label mt-2 text-ivory/55">
              {property.city} · {property.districtLabel} — {property.typeLabel}
            </p>
          </div>
        </header>

        <div className="shell-wide flex-1 pb-10">
          {data?.storeKind === "development" && (
            <p className="label mb-6 border border-champagne/30 bg-champagne/5 px-4 py-3 text-champagne/90">
              Development store — bookings are saved locally, not to Supabase.
            </p>
          )}

          {loadError && <Notice tone="error">{loadError}</Notice>}

          {appointmentOnly ? (
            <AppointmentOnly property={property} />
          ) : step === "done" && confirmed ? (
            <Confirmation booking={confirmed} cancelled={cancelled} onCancel={cancelBooking} onClose={close} onAgain={reset} />
          ) : (
            <>
              <Steps current={step} />

              {step === "when" && (
                <section className="mt-8">
                  <h3 className="label text-ivory/45">Select a date</h3>
                  <div className="mt-5">
                    {loading && !data ? (
                      <p className="label py-10 text-center text-ivory/40">Loading available dates…</p>
                    ) : (
                      <BookingCalendar
                        month={month}
                        availableDates={availableDates}
                        selected={date}
                        minDate={data?.from ?? businessToday()}
                        maxDate={data?.to ?? addDays(businessToday(), 60)}
                        onSelect={(d) => { setDate(d); setTime(null); }}
                        onMonthChange={setMonthOverride}
                      />
                    )}
                  </div>

                  {date && (
                    <div className="mt-10">
                      <h3 className="label text-ivory/45">Available times</h3>
                      <p className="label mt-2 text-ivory/30">{formatDateLong(date)} · Yerevan time</p>

                      {slotsForDate.length === 0 ? (
                        <p className="label mt-5 text-ivory/40">No times remain on this date.</p>
                      ) : (
                        <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3">
                          {slotsForDate.map((s) => (
                            <button
                              key={s.start}
                              type="button"
                              onClick={() => setTime(s.start)}
                              aria-pressed={time === s.start}
                              className={[
                                "border px-3 py-4 text-[0.8rem] tracking-[0.12em] transition-all duration-300",
                                time === s.start
                                  ? "border-champagne bg-champagne text-black"
                                  : "border-ivory/15 text-ivory/85 hover:border-champagne/60 hover:text-champagne",
                              ].join(" ")}
                            >
                              {formatTime12(s.start)}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {date && time && (
                    <>
                      <Summary property={property} date={date} time={time} />
                      <button
                        type="button"
                        onClick={() => setStep("details")}
                        className="label-lg group mt-6 flex w-full items-center justify-center gap-3 bg-ivory px-6 py-4 text-ink transition-colors duration-500 hover:bg-champagne"
                      >
                        Continue
                        <span className="arrow-slide" aria-hidden>→</span>
                      </button>
                    </>
                  )}
                </section>
              )}

              {step === "details" && date && time && (
                <form onSubmit={submit} className="mt-8">
                  <Summary property={property} date={date} time={time} />

                  <h3 className="label mt-9 text-ivory/45">Your details</h3>
                  <div className="mt-5 space-y-5">
                    <Field label="Full name" value={form.name} error={fieldErrors.name} autoComplete="name"
                      onChange={(v) => setForm({ ...form, name: v })} required />
                    <Field label="Phone number" value={form.phone} error={fieldErrors.phone} type="tel" autoComplete="tel"
                      onChange={(v) => setForm({ ...form, phone: v })} required />
                    <Field label="Email address" value={form.email} error={fieldErrors.email} type="email" autoComplete="email"
                      onChange={(v) => setForm({ ...form, email: v })} required />
                    <Field label="Anything we should know (optional)" value={form.message} error={fieldErrors.message}
                      onChange={(v) => setForm({ ...form, message: v })} multiline />
                  </div>

                  <label className="mt-6 flex cursor-pointer items-start gap-3">
                    <input
                      type="checkbox"
                      checked={form.consent}
                      onChange={(e) => setForm({ ...form, consent: e.target.checked })}
                      className="mt-[3px] h-4 w-4 shrink-0 appearance-none border border-ivory/30 transition-colors duration-300 checked:border-champagne checked:bg-champagne focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-champagne"
                    />
                    <span className="text-[0.82rem] leading-relaxed text-ivory/60">
                      I agree to be contacted regarding this viewing.
                    </span>
                  </label>

                  {submitError && <Notice tone="error">{submitError}</Notice>}

                  <div className="mt-7 flex flex-col gap-3 sm:flex-row-reverse">
                    <button
                      type="submit"
                      disabled={submitting}
                      className="label-lg group flex flex-1 items-center justify-center gap-3 bg-ivory px-6 py-4 text-ink transition-colors duration-500 hover:bg-champagne disabled:opacity-50"
                    >
                      {submitting ? "Confirming…" : "Confirm viewing"}
                      {!submitting && <span className="arrow-slide" aria-hidden>→</span>}
                    </button>
                    <button
                      type="button"
                      onClick={() => setStep("when")}
                      className="label-lg border border-ivory/20 px-6 py-4 text-ivory/70 transition-colors duration-500 hover:border-ivory/50 hover:text-ivory"
                    >
                      Back
                    </button>
                  </div>

                  <p className="label mt-4 text-ivory/30">
                    No account needed. We will confirm by phone or email.
                  </p>
                </form>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* --------------------------------- pieces --------------------------------- */

function Steps({ current }: { current: Step }) {
  const steps: { id: Step; label: string }[] = [
    { id: "when", label: "Date & time" },
    { id: "details", label: "Your details" },
    { id: "done", label: "Confirmed" },
  ];
  const index = steps.findIndex((s) => s.id === current);

  return (
    <ol className="flex items-center gap-3 border-b border-ivory/10 pb-5 pt-7">
      {steps.map((s, i) => (
        <li key={s.id} className="flex items-center gap-3">
          <span className={`label ${i <= index ? "text-champagne" : "text-ivory/25"}`}>
            0{i + 1} {s.label}
          </span>
          {i < steps.length - 1 && <span className="h-px w-4 bg-ivory/15" aria-hidden />}
        </li>
      ))}
    </ol>
  );
}

function Summary({ property, date, time }: { property: Property; date: string; time: string }) {
  const rows = [
    { label: "Property", value: property.name },
    { label: "Date", value: formatDateLong(date) },
    { label: "Time", value: `${formatTime12(time)} · Yerevan` },
    { label: "Viewing type", value: "Private viewing, in person" },
  ];
  return (
    <dl className="mt-8 border-y border-ivory/12 py-5">
      {rows.map((r) => (
        <div key={r.label} className="flex items-baseline justify-between gap-6 py-2">
          <dt className="label text-ivory/40">{r.label}</dt>
          <dd className="text-right text-[0.9rem] text-ivory">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Confirmation({
  booking, cancelled, onCancel, onClose, onAgain,
}: {
  booking: ConfirmedBooking; cancelled: boolean;
  onCancel: () => void; onClose: () => void; onAgain: () => void;
}) {
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  if (cancelled) {
    return (
      <div className="py-12">
        <p className="label text-ivory/45">Booking {booking.reference}</p>
        <h3 className="display-sm mt-4">Your viewing has been cancelled.</h3>
        <p className="mt-4 max-w-[38ch] text-[0.92rem] leading-relaxed text-ivory/60">
          The time has been released. You are welcome to book another whenever suits you.
        </p>
        <div className="mt-8 flex flex-col gap-3">
          <button type="button" onClick={onAgain} className="label-lg bg-ivory px-6 py-4 text-ink transition-colors duration-500 hover:bg-champagne">
            Book another viewing
          </button>
          <button type="button" onClick={onClose} className="label-lg border border-ivory/20 px-6 py-4 text-ivory/70 transition-colors duration-500 hover:border-ivory/50 hover:text-ivory">
            Close
          </button>
        </div>
      </div>
    );
  }

  const rows = [
    { label: "Property", value: booking.property.title },
    { label: "Date", value: formatDateLong(booking.date) },
    { label: "Time", value: `${formatTime12(booking.startTime)} – ${formatTime12(booking.endTime)} · Yerevan` },
    { label: "Location", value: booking.property.address ?? booking.property.location },
    { label: "Booking", value: booking.reference },
  ];

  return (
    <div className="py-10">
      <div className="flex items-center gap-4">
        <span className="h-px w-10 gold-rule" aria-hidden />
        <p className="label text-champagne">Viewing confirmed</p>
      </div>

      <h3 className="display-sm mt-5">Your private viewing has been scheduled.</h3>

      <dl className="mt-8 border-y border-ivory/12 py-5">
        {rows.map((r) => (
          <div key={r.label} className="flex items-baseline justify-between gap-6 py-2.5">
            <dt className="label text-ivory/40">{r.label}</dt>
            <dd className={`text-right text-[0.9rem] ${r.label === "Booking" ? "text-champagne" : "text-ivory"}`}>{r.value}</dd>
          </div>
        ))}
      </dl>

      <p className="mt-6 font-display text-[1.4rem] leading-snug text-ivory/85">
        We look forward to seeing you.
      </p>
      <p className="label mt-4 text-ivory/40">
        Keep this reference. We will send a reminder 24 hours before, so you can confirm or cancel in one tap.
      </p>

      <div className="mt-8 flex flex-col gap-3">
        <a
          href={`/api/bookings/${booking.reference}/calendar?token=${booking.manageToken}`}
          className="label-lg flex items-center justify-center gap-3 bg-ivory px-6 py-4 text-ink transition-colors duration-500 hover:bg-champagne"
        >
          Add to calendar
        </a>
        <a
          href={`/viewings/${booking.reference}?token=${booking.manageToken}`}
          className="label-lg flex items-center justify-center border border-ivory/20 px-6 py-4 text-ivory/75 transition-colors duration-500 hover:border-champagne hover:text-champagne"
        >
          Manage this viewing
        </a>

        {confirmingCancel ? (
          <div className="border border-ivory/15 p-5">
            <p className="text-[0.88rem] text-ivory/70">Cancel this viewing and release the time?</p>
            <div className="mt-4 flex gap-3">
              <button type="button" onClick={onCancel} className="label border border-champagne px-4 py-3 text-champagne transition-colors duration-300 hover:bg-champagne hover:text-black">
                Yes, cancel
              </button>
              <button type="button" onClick={() => setConfirmingCancel(false)} className="label px-4 py-3 text-ivory/50 hover:text-ivory">
                Keep it
              </button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setConfirmingCancel(true)} className="label py-2 text-ivory/35 transition-colors duration-300 hover:text-ivory/70">
            Cancel viewing
          </button>
        )}
      </div>
    </div>
  );
}

function AppointmentOnly({ property }: { property: Property }) {
  return (
    <div className="py-12">
      <p className="label text-champagne">By appointment</p>
      <h3 className="display-sm mt-4">This one we show personally.</h3>
      <p className="mt-5 max-w-[40ch] text-[0.92rem] leading-relaxed text-ivory/65">
        {property.name} is viewed by arrangement rather than from a published schedule. Tell us when
        suits you and we will meet you there.
      </p>
      <Link
        href="/#contact"
        className="label-lg mt-8 flex items-center justify-center gap-3 bg-ivory px-6 py-4 text-ink transition-colors duration-500 hover:bg-champagne"
      >
        Contact VIP Realty
        <span aria-hidden>→</span>
      </Link>
    </div>
  );
}

function Notice({ tone, children }: { tone: "error" | "info"; children: React.ReactNode }) {
  return (
    <p
      role={tone === "error" ? "alert" : undefined}
      className={`label mt-6 border px-4 py-3 ${
        tone === "error" ? "border-champagne/40 bg-champagne/5 text-champagne" : "border-ivory/15 text-ivory/60"
      }`}
    >
      {children}
    </p>
  );
}

function Field({
  label, value, onChange, error, type = "text", multiline, required, autoComplete,
}: {
  label: string; value: string; onChange: (v: string) => void; error?: string;
  type?: string; multiline?: boolean; required?: boolean; autoComplete?: string;
}) {
  const cls = `w-full border-b bg-transparent py-3 text-[0.95rem] text-ivory outline-none transition-colors duration-400 placeholder:text-ivory/30 ${
    error ? "border-champagne" : "border-ivory/15 focus:border-champagne"
  }`;
  return (
    <label className="block">
      <span className="label text-ivory/40">{label}</span>
      {multiline ? (
        <textarea rows={3} value={value} onChange={(e) => onChange(e.target.value)} className={`${cls} resize-none`} />
      ) : (
        <input
          type={type}
          value={value}
          required={required}
          autoComplete={autoComplete}
          onChange={(e) => onChange(e.target.value)}
          className={cls}
        />
      )}
      {error && <span className="label mt-2 block text-champagne">{error}</span>}
    </label>
  );
}
