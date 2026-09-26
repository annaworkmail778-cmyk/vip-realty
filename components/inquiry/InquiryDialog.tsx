"use client";

import { useEffect, useRef, useState } from "react";
import {
  INQUIRY_LIMITS,
  validateInquiryFields,
  type InquiryField,
  type InquiryFieldErrors,
} from "@/lib/inquiries/validation";
import { useDict } from "@/components/site/LocaleProvider";
import { fill } from "@/lib/i18n/fill";

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
  const dict = useDict();
  const defaultMessage = fill(dict.inquiry.defaultMessage, { name: listing.name });

  /* `validateInquiryFields` is the rule source shared with the API route and the
     database function, and its own messages are English. It is used here only to
     learn WHICH fields failed; the wording shown to the visitor comes from the
     dictionary, keyed by field. The same mapping is applied to field errors the
     server returns, so nothing English can reach the form. */
  const fieldError: Record<InquiryField, string> = {
    name: dict.inquiry.errName,
    phone: dict.inquiry.errPhone,
    email: dict.inquiry.errEmail,
    message: fill(dict.inquiry.errMessage, { max: INQUIRY_LIMITS.messageMax }),
  };

  /* The API answers with a machine-readable `error` code alongside its English
     `message`; the code is what gets translated, so app/api stays untouched. */
  const noticeFor = (code: string | undefined) =>
    code === "rate_limited"
      ? dict.inquiry.errRateLimited
      : code === "invalid_input"
        ? dict.inquiry.errInvalid
        : code === "property_unavailable"
          ? dict.inquiry.errPropertyUnavailable
          : dict.inquiry.errUnavailable;

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
        ok?: boolean; error?: string; fields?: InquiryFieldErrors;
      };

      if (res.ok && body.ok) {
        setStatus("sent");
        setSubmissionId(newSubmissionId());
        return;
      }
      setErrors(body.fields ?? {});
      setNotice(noticeFor(body.error));
      setStatus("idle");
    } catch {
      setNotice(dict.inquiry.errNetwork);
      setStatus("idle");
    }
  };

  return (
    <div className="fixed inset-0 z-[120]" role="dialog" aria-modal="true" aria-label={dict.contact.requestInfo}>
      <button
        type="button"
        aria-label={dict.nav.close}
        onClick={close}
        className="absolute inset-0 bg-black/70 backdrop-blur-[2px] animate-[fade_.4s_ease]"
      />

      <div className="absolute inset-0 flex flex-col overflow-y-auto bg-ink text-ivory sm:inset-y-0 sm:left-auto sm:right-0 sm:w-[min(34rem,100vw)] sm:border-l sm:border-ivory/12 side-panel-in">
        <header className="shell-wide relative shrink-0 border-b border-ivory/10 pb-6 pt-8">
          <button
            type="button"
            onClick={close}
            aria-label={dict.nav.close}
            className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center border border-ivory/25 text-ivory transition-colors duration-300 hover:border-champagne hover:text-champagne"
          >
            ✕
          </button>
          <p className="label text-champagne">{dict.contact.requestInfo}</p>
          <h2 ref={headingRef} tabIndex={-1} className="display-sm mt-2 pr-12 outline-none">{listing.name}</h2>
          <p className="label mt-2 text-ivory/55">{listing.location} — {listing.price}</p>
        </header>

        <div className="shell-wide flex-1 pb-10">
          {status === "sent" ? (
            <div className="pt-10" role="status">
              <p className="label text-champagne">{dict.inquiry.sentLabel}</p>
              <p className="display-sm mt-3">{dict.inquiry.sentTitle}</p>
              <button
                type="button"
                onClick={close}
                className="label-lg mt-8 flex w-full items-center justify-center gap-3 bg-ivory px-6 py-4 text-ink transition-colors duration-500 hover:bg-champagne"
              >
                {dict.nav.close}
              </button>
            </div>
          ) : (
            <form onSubmit={submit} noValidate className="mt-8">
              <div className="space-y-5">
                <Field label={dict.inquiry.fieldName} value={form.name}
                  error={errors.name && fieldError.name} autoComplete="name"
                  onChange={(v) => setForm({ ...form, name: v })} required />
                <Field label={dict.inquiry.fieldPhone} value={form.phone}
                  error={errors.phone && fieldError.phone} type="tel" autoComplete="tel"
                  onChange={(v) => setForm({ ...form, phone: v })} required />
                <Field label={dict.inquiry.fieldEmail} value={form.email}
                  error={errors.email && fieldError.email} type="email" autoComplete="email"
                  onChange={(v) => setForm({ ...form, email: v })} />
                <Field label={dict.inquiry.fieldMessage} value={form.message}
                  error={errors.message && fieldError.message}
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
                {status === "submitting" ? dict.inquiry.sending : dict.inquiry.send}
                {status !== "submitting" && <span className="arrow-slide" aria-hidden>→</span>}
              </button>

              <p className="label mt-4 text-ivory/30">{dict.inquiry.privacy}</p>
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
