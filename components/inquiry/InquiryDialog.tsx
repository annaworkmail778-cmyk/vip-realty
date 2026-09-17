"use client";

import { useEffect, useRef, useState } from "react";
import { validateInquiryFields, type InquiryFieldErrors } from "@/lib/inquiries/validation";

export interface InquiryListing {
  slug: string;
  name: string;
  location: string;
  price: string;
}

type Status = "idle" | "submitting" | "sent";

const newSubmissionId = () => crypto.randomUUID();

/* ----------------------------------------------------------------------------
   "Request more information" panel. Slides in from the right on desktop and up
   on a phone. Posts to /api/inquiries; the listing is identified by its slug
   and verified server-side. A submission id makes accidental double submits
   harmless; a fresh id is issued after each successful request.
---------------------------------------------------------------------------- */

export function InquiryDialog({
  listing, open, onClose,
}: { listing: InquiryListing; open: boolean; onClose: () => void }) {
  const defaultMessage = `I'd like more information about ${listing.name}.`;
  const [form, setForm] = useState({ name: "", phone: "", email: "", message: defaultMessage, company: "" });
  const [errors, setErrors] = useState<InquiryFieldErrors>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [submissionId, setSubmissionId] = useState(newSubmissionId);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Escape closes, and the page behind stops scrolling while the panel is up.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    headingRef.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;

  const close = () => {
    if (status === "sent") {
      setForm({ name: "", phone: "", email: "", message: defaultMessage, company: "" });
      setStatus("idle");
    }
    setErrors({});
    setNotice(null);
    onClose();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (status === "submitting") return;

    const fieldErrors = validateInquiryFields(form);
    setErrors(fieldErrors);
    setNotice(null);
    if (Object.keys(fieldErrors).length > 0) return;

    setStatus("submitting");
    try {
      const res = await fetch("/api/inquiries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertySlug: listing.slug, submissionId, ...form }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean; message?: string; fields?: InquiryFieldErrors;
      };

      if (res.ok && body.ok) {
        setStatus("sent");
        setSubmissionId(newSubmissionId());
        return;
      }
      setErrors(body.fields ?? {});
      setNotice(body.message ?? "We couldn't send your request. Please try again.");
      setStatus("idle");
    } catch {
      setNotice("We couldn't send your request. Please check your connection and try again.");
      setStatus("idle");
    }
  };

  return (
    <div className="fixed inset-0 z-[120]" role="dialog" aria-modal="true" aria-label="Request more information">
      <button
        type="button"
        aria-label="Close"
        onClick={close}
        className="absolute inset-0 bg-black/70 backdrop-blur-[2px] animate-[fade_.4s_ease]"
      />

      <div className="absolute inset-0 flex flex-col overflow-y-auto bg-ink text-ivory sm:inset-y-0 sm:left-auto sm:right-0 sm:w-[min(34rem,100vw)] sm:border-l sm:border-ivory/12 side-panel-in">
        <header className="shell-wide relative shrink-0 border-b border-ivory/10 pb-6 pt-8">
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center border border-ivory/25 text-ivory transition-colors duration-300 hover:border-champagne hover:text-champagne"
          >
            ✕
          </button>
          <p className="label text-champagne">Request more information</p>
          <h2 ref={headingRef} tabIndex={-1} className="display-sm mt-2 pr-12 outline-none">{listing.name}</h2>
          <p className="label mt-2 text-ivory/55">{listing.location} — {listing.price}</p>
        </header>

        <div className="shell-wide flex-1 pb-10">
          {status === "sent" ? (
            <div className="pt-10" role="status">
              <p className="label text-champagne">Request sent</p>
              <p className="display-sm mt-3">Thank you. We&rsquo;ll be in touch shortly.</p>
              <button
                type="button"
                onClick={close}
                className="label-lg mt-8 flex w-full items-center justify-center gap-3 bg-ivory px-6 py-4 text-ink transition-colors duration-500 hover:bg-champagne"
              >
                Close
              </button>
            </div>
          ) : (
            <form onSubmit={submit} noValidate className="mt-8">
              <div className="space-y-5">
                <Field label="Full name" value={form.name} error={errors.name} autoComplete="name"
                  onChange={(v) => setForm({ ...form, name: v })} required />
                <Field label="Phone number" value={form.phone} error={errors.phone} type="tel" autoComplete="tel"
                  onChange={(v) => setForm({ ...form, phone: v })} required />
                <Field label="Email address (optional)" value={form.email} error={errors.email} type="email" autoComplete="email"
                  onChange={(v) => setForm({ ...form, email: v })} />
                <Field label="Message" value={form.message} error={errors.message}
                  onChange={(v) => setForm({ ...form, message: v })} multiline />
              </div>

              {/* Honeypot — hidden from people and assistive technology. */}
              <div aria-hidden="true" className="hidden">
                <label>
                  Company
                  <input tabIndex={-1} autoComplete="off" value={form.company}
                    onChange={(e) => setForm({ ...form, company: e.target.value })} />
                </label>
              </div>

              {notice && (
                <p role="alert" className="label mt-6 border border-champagne/40 bg-champagne/5 px-4 py-3 text-champagne">
                  {notice}
                </p>
              )}

              <button
                type="submit"
                disabled={status === "submitting"}
                className="label-lg group mt-8 flex w-full items-center justify-center gap-3 bg-ivory px-6 py-4 text-ink transition-colors duration-500 hover:bg-champagne disabled:opacity-50"
              >
                {status === "submitting" ? "Sending…" : "Send request"}
                {status !== "submitting" && <span className="arrow-slide" aria-hidden>→</span>}
              </button>

              <p className="label mt-4 text-ivory/30">
                We use these details only to answer your request.
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
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
        <textarea rows={4} value={value} onChange={(e) => onChange(e.target.value)} className={`${cls} resize-none`}
          aria-invalid={Boolean(error)} />
      ) : (
        <input
          type={type}
          value={value}
          required={required}
          autoComplete={autoComplete}
          onChange={(e) => onChange(e.target.value)}
          className={cls}
          aria-invalid={Boolean(error)}
        />
      )}
      {error && <span className="label mt-2 block text-champagne">{error}</span>}
    </label>
  );
}
