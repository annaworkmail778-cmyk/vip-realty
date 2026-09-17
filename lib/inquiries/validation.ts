/* ----------------------------------------------------------------------------
   "Request more information" input rules. Shared by the form (instant feedback)
   and the API route (authoritative). The database function `submit_inquiry`
   re-checks the same rules and verifies the property is published.

   Client-safe: no server imports.
---------------------------------------------------------------------------- */

export const INQUIRY_LIMITS = {
  nameMin: 2,
  nameMax: 120,
  emailMax: 254,
  messageMax: 2000,
  phoneDigitsMin: 7,
  phoneDigitsMax: 15,
} as const;

export interface InquiryInput {
  propertySlug: string;
  name: string;
  phone: string;
  email: string | null;
  message: string | null;
  submissionId: string;
}

export type InquiryField = "name" | "phone" | "email" | "message";
export type InquiryFieldErrors = Partial<Record<InquiryField, string>>;

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PHONE_CHARS = /^\+?[0-9 ().-]{6,32}$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

export function validateInquiryFields(values: {
  name: string; phone: string; email: string; message: string;
}): InquiryFieldErrors {
  const errors: InquiryFieldErrors = {};
  const name = values.name.trim();
  const phone = values.phone.trim();
  const email = values.email.trim();
  const message = values.message.trim();
  const digits = phone.replace(/\D/g, "").length;

  if (name.length < INQUIRY_LIMITS.nameMin || name.length > INQUIRY_LIMITS.nameMax) {
    errors.name = "Please enter your name.";
  }
  if (!PHONE_CHARS.test(phone) || digits < INQUIRY_LIMITS.phoneDigitsMin || digits > INQUIRY_LIMITS.phoneDigitsMax) {
    errors.phone = "Please enter a valid phone number.";
  }
  if (email && (email.length > INQUIRY_LIMITS.emailMax || !EMAIL.test(email))) {
    errors.email = "Please enter a valid email address, or leave it empty.";
  }
  if (message.length > INQUIRY_LIMITS.messageMax) {
    errors.message = `Please keep the message under ${INQUIRY_LIMITS.messageMax} characters.`;
  }
  return errors;
}

/** Validates an untrusted request body. */
export function parseInquiry(raw: unknown):
  | { ok: true; value: InquiryInput }
  | { ok: false; errors: InquiryFieldErrors; malformed: boolean } {
  const body = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};

  const propertySlug = text(body.propertySlug);
  const submissionId = text(body.submissionId);
  if (!SLUG.test(propertySlug) || propertySlug.length > 200 || !UUID.test(submissionId)) {
    return { ok: false, errors: {}, malformed: true };
  }

  const values = { name: text(body.name), phone: text(body.phone), email: text(body.email), message: text(body.message) };
  const errors = validateInquiryFields(values);
  if (Object.keys(errors).length > 0) return { ok: false, errors, malformed: false };

  return {
    ok: true,
    value: {
      propertySlug,
      submissionId: submissionId.toLowerCase(),
      name: values.name,
      phone: values.phone,
      email: values.email || null,
      message: values.message || null,
    },
  };
}
