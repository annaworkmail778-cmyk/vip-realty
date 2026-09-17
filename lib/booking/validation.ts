/* ----------------------------------------------------------------------------
   Server-side validation.

   The booking form validates as you type, but nothing here trusts that: every
   API route re-checks the whole payload before it reaches the database, which
   itself re-checks the slot. Three layers, and only the last two matter.
---------------------------------------------------------------------------- */

import type { CreateBookingInput } from "./types";

export interface FieldErrors { [field: string]: string }

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;
const PHONE = /^[+()\-\s\d]{5,40}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

export function validateBookingInput(raw: unknown): { ok: true; value: CreateBookingInput } | { ok: false; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const body = (raw ?? {}) as Record<string, unknown>;
  const str = (k: string) => (typeof body[k] === "string" ? (body[k] as string).trim() : "");

  const propertySlug = str("propertySlug");
  const date = str("date");
  const startTime = str("startTime").slice(0, 5);
  const name = str("name");
  const phone = str("phone");
  const email = str("email").toLowerCase();
  const message = str("message");

  if (!propertySlug) errors.propertySlug = "Missing property.";
  if (!DATE.test(date)) errors.date = "Choose a date.";
  if (!TIME.test(startTime)) errors.startTime = "Choose a time.";
  if (name.length < 2 || name.length > 120) errors.name = "Please enter your full name.";
  if (!PHONE.test(phone)) errors.phone = "Please enter a phone number we can reach you on.";
  if (!EMAIL.test(email) || email.length > 160) errors.email = "Please enter a valid email address.";
  if (message.length > 1000) errors.message = "Please keep your message under 1,000 characters.";

  if (Object.keys(errors).length) return { ok: false, errors };

  return {
    ok: true,
    value: {
      propertySlug, date, startTime, name, phone, email,
      message: message || undefined,
      consent: body.consent === true,
      viewingType: body.viewingType === "virtual" ? "virtual" : "in_person",
      source: "website",
    },
  };
}

export const isDate = (v: unknown): v is string => typeof v === "string" && DATE.test(v);
export const isTime = (v: unknown): v is string => typeof v === "string" && TIME.test(v);
export const isUuid = (v: unknown): v is string =>
  typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
export const isReference = (v: unknown): v is string =>
  typeof v === "string" && /^VIP-\d{4}-\d{4,6}$/.test(v);
