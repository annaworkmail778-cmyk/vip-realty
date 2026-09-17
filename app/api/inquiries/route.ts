import { NextResponse } from "next/server";
import { parseInquiry } from "@/lib/inquiries/validation";
import { clientKey, rateLimit } from "@/lib/security/rate-limit";
import { supabasePublic } from "@/lib/supabase/public";

export const dynamic = "force-dynamic";

/* ----------------------------------------------------------------------------
   POST /api/inquiries — "Request more information" from a listing page.

   browser → this route (validation, rate limit, honeypot)
           → Supabase `submit_inquiry` (least-privilege publishable key)
           → re-validates, verifies the listing is published, inserts.

   The browser never writes to Supabase and never names an arbitrary property
   id: it sends the listing slug, which the database resolves to a published
   listing or rejects. Duplicate submits of the same form reuse one inquiry
   (submissionId). Database errors are logged, never returned.
---------------------------------------------------------------------------- */

const MAX_BODY_BYTES = 10_000;

const reply = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status });

const UNAVAILABLE = { ok: false, error: "unavailable", message: "We couldn't send your request right now. Please try again, or contact us by phone or WhatsApp." };

export async function POST(req: Request) {
  if (!rateLimit(clientKey(req, "inquiry"), 5, 60_000)) {
    return reply(429, { ok: false, error: "rate_limited", message: "Too many requests. Please wait a moment and try again." });
  }

  const raw = await req.text().catch(() => "");
  if (raw.length === 0 || raw.length > MAX_BODY_BYTES) {
    return reply(400, { ok: false, error: "invalid_input", message: "Please check the form and try again." });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return reply(400, { ok: false, error: "invalid_input", message: "Please check the form and try again." });
  }

  // Honeypot: real visitors never see or fill this field. Answer as if accepted.
  const trap = (body as { company?: unknown } | null)?.company;
  if (typeof trap === "string" && trap.trim() !== "") {
    return reply(201, { ok: true });
  }

  const parsed = parseInquiry(body);
  if (!parsed.ok) {
    return reply(400, {
      ok: false,
      error: "invalid_input",
      message: "Please check the highlighted fields.",
      fields: parsed.errors,
    });
  }

  const client = supabasePublic();
  if (!client) {
    console.error("[inquiries] Supabase public access is not configured.");
    return reply(503, UNAVAILABLE);
  }

  const { value } = parsed;
  const { data, error } = await client.rpc("submit_inquiry", {
    p_property_slug: value.propertySlug,
    p_name: value.name,
    p_phone: value.phone,
    p_email: value.email,
    p_message: value.message,
    p_client_submission_id: value.submissionId,
  });

  if (error) {
    console.error("[inquiries] submit failed", { code: error.code });
    return reply(503, UNAVAILABLE);
  }

  const result = (typeof data === "object" && data !== null ? data : {}) as { ok?: unknown; error?: unknown };
  if (result.ok === true) return reply(201, { ok: true });

  switch (result.error) {
    case "property_unavailable":
      return reply(409, { ok: false, error: "property_unavailable", message: "This property is no longer available. Please contact us directly." });
    case "rate_limited":
      return reply(429, { ok: false, error: "rate_limited", message: "We already have your request for this property. We'll be in touch soon." });
    case "invalid_input":
      return reply(400, { ok: false, error: "invalid_input", message: "Please check the form and try again." });
    default:
      console.error("[inquiries] unexpected submit result");
      return reply(503, UNAVAILABLE);
  }
}
