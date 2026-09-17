import { NextResponse } from "next/server";
import { getBookingStore } from "@/lib/booking";
import { validateBookingInput } from "@/lib/booking/validation";
import { ERROR_MESSAGES } from "@/lib/booking/types";
import { clientKey, rateLimit } from "@/lib/booking/rate-limit";
import { dispatchSoon } from "@/lib/notifications/dispatch";

export const dynamic = "force-dynamic";

/* POST /api/bookings — create a viewing as a guest.

   The payload is re-validated here regardless of what the form did, and the
   slot itself is re-checked inside the database transaction that inserts the
   row, so a slot taken a moment ago fails cleanly rather than double-booking. */
export async function POST(req: Request) {
  if (!rateLimit(clientKey(req, "book"), 8, 60_000)) {
    return NextResponse.json(
      { ok: false, error: "rate_limited", message: "Too many attempts. Please wait a moment and try again." },
      { status: 429 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_input" }, { status: 400 });
  }

  const parsed = validateBookingInput(body);
  if (!parsed.ok) {
    return NextResponse.json(
      { ok: false, error: "invalid_input", message: ERROR_MESSAGES.invalid_input, fields: parsed.errors },
      { status: 422 },
    );
  }

  const store = getBookingStore();
  const result = await store.createBooking(parsed.value);

  if (!result.ok) {
    // 409 for a lost race, so the client knows to refresh the slot list.
    const status = result.error === "slot_taken" || result.error === "slot_unavailable" ? 409 : 400;
    return NextResponse.json(
      { ok: false, error: result.error, message: ERROR_MESSAGES[result.error] },
      { status },
    );
  }

  dispatchSoon();

  const b = result.booking;
  return NextResponse.json({
    ok: true,
    booking: {
      reference: b.reference,
      property: { title: b.propertyTitle, location: b.propertyLocation, address: b.propertyAddress, slug: b.propertySlug },
      date: b.date,
      startTime: b.startTime,
      endTime: b.endTime,
      viewingType: b.viewingType,
      status: b.status,
      // The token is the customer's only key to their own booking. It is
      // returned once, here, and never listed by any other endpoint.
      manageToken: b.manageToken,
    },
  }, { status: 201 });
}
