"use client";

import { useFormStatus } from "react-dom";
import type { ActionState } from "@/lib/admin/management-actions";

/* ----------------------------------------------------------------------------
   Shared admin form pieces: plain labelled inputs, a submit button that
   disables itself while a request is in flight (so a double click cannot send
   the same mutation twice) and a result line that shows the database's answer.
---------------------------------------------------------------------------- */

const inputClass =
  "mt-2 w-full border border-ivory/15 bg-transparent px-3 py-2.5 text-[0.9rem] text-ivory outline-none " +
  "focus:border-champagne disabled:opacity-40";

export function Field({
  label, name, defaultValue, type = "text", required = false, placeholder, hint, disabled = false, maxLength, step,
}: {
  label: string; name: string; defaultValue?: string | number | null; type?: string; required?: boolean;
  placeholder?: string; hint?: string; disabled?: boolean; maxLength?: number; step?: string;
}) {
  return (
    <label className="block">
      <span className="label text-ivory/40">{label}{required && <span className="text-champagne"> *</span>}</span>
      <input
        name={name}
        type={type}
        defaultValue={defaultValue ?? ""}
        required={required}
        placeholder={placeholder}
        disabled={disabled}
        maxLength={maxLength}
        step={step}
        className={inputClass}
      />
      {hint && <span className="label mt-1.5 block text-[0.6rem] text-ivory/30">{hint}</span>}
    </label>
  );
}

export function TextArea({
  label, name, defaultValue, rows = 5, maxLength, hint,
}: { label: string; name: string; defaultValue?: string | null; rows?: number; maxLength?: number; hint?: string }) {
  return (
    <label className="block">
      <span className="label text-ivory/40">{label}</span>
      <textarea name={name} defaultValue={defaultValue ?? ""} rows={rows} maxLength={maxLength} className={inputClass} />
      {hint && <span className="label mt-1.5 block text-[0.6rem] text-ivory/30">{hint}</span>}
    </label>
  );
}

export function Select({
  label, name, defaultValue, options, hint, disabled = false,
}: {
  label: string; name: string; defaultValue?: string | null; hint?: string; disabled?: boolean;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="block">
      <span className="label text-ivory/40">{label}</span>
      <select name={name} defaultValue={defaultValue ?? ""} disabled={disabled} className={inputClass}>
        {options.map((o) => (
          <option key={o.value} value={o.value} className="bg-ink text-ivory">{o.label}</option>
        ))}
      </select>
      {hint && <span className="label mt-1.5 block text-[0.6rem] text-ivory/30">{hint}</span>}
    </label>
  );
}

export function Toggle({
  label, name, defaultChecked, hint, disabled = false,
}: { label: string; name: string; defaultChecked?: boolean; hint?: string; disabled?: boolean }) {
  return (
    <label className="flex items-start gap-3">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} disabled={disabled}
             className="mt-1 h-4 w-4 accent-champagne disabled:opacity-40" />
      <span>
        <span className="label text-ivory/70">{label}</span>
        {hint && <span className="label mt-1 block text-[0.6rem] text-ivory/30">{hint}</span>}
      </span>
    </label>
  );
}

export function Submit({ children = "Save", tone = "primary" }: { children?: React.ReactNode; tone?: "primary" | "default" }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={`label px-5 py-2.5 transition-colors duration-300 disabled:opacity-40 ${
        tone === "primary" ? "bg-ivory text-ink hover:bg-champagne" : "border border-ivory/25 text-ivory hover:border-champagne"
      }`}
    >
      {pending ? "Saving…" : children}
    </button>
  );
}

export function Result({ state }: { state: ActionState }) {
  if (!state) return null;
  return (
    <p role="status" className={`label mt-4 ${state.ok ? "text-champagne" : "text-ivory/80"}`}>
      {state.message}
    </p>
  );
}
