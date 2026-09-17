import { NextResponse } from "next/server";
import { getBookingStore } from "@/lib/booking";
import { ERROR_MESSAGES } from "@/lib/booking/types";
import { isReference, isUuid } from "@/lib/booking/validation";
import { clientKey, rateLimit } from "@/lib/booking/rate-limit";
import { dispatchSoon } from "@/lib/notifications/dispatch";

export const dynamic = "force-dynamic";

/* POST /api/bookings/<reference>/cancel  { token, reason? }
   Cancelling releases the slot immediately: the partial unique index stops
   applying and the next availability query offers the time again. */
export async function POST(req: Request, ctx: { params: Promise<{ reference: string }> }) {
  if (!rateLimit(clientKey(req, "cancel"), 20, 60_000)) {
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }

  const { reference } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const token = (body as { token?: string }).token;
  const reason = typeof (body as { reason?: string }).reason === "string"
    ? (body as { reason: string }).reason.slice(0, 500) : undefined;

  if (!isReference(reference) || !isUuid(token)) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }

  const result = await getBookingStore().cancelBooking(reference, "customer", token, reason);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error, message: ERROR_MESSAGES[result.error] }, { status: 400 });
  }

  dispatchSoon();
  return NextResponse.json({ ok: true, status: result.booking.status, already: result.already ?? false });
}
