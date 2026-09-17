import { NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/admin/auth";
import { getBookingStore } from "@/lib/booking";
import { BOOKING_STATUSES, ERROR_MESSAGES, type BookingStatus } from "@/lib/booking/types";
import { isDate, isTime } from "@/lib/booking/validation";
import { dispatchSoon } from "@/lib/notifications/dispatch";
import type { Booking } from "@/lib/booking/types";

/** Admin responses never carry the customer's manage token. */
const forAdmin = ({ manageToken: _omit, ...rest }: Booking) => rest;

export const dynamic = "force-dynamic";

/* PATCH — the admin actions: confirm, cancel, complete, no-show, reschedule,
   and internal notes. Reschedule goes through the same atomic database
   function the customer path uses. */
export async function PATCH(req: Request, ctx: { params: Promise<{ reference: string }> }) {
  if (!isAdminRequest(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const { reference } = await ctx.params;
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const store = getBookingStore();
  const action = typeof body.action === "string" ? body.action : "";

  if (action === "reschedule") {
    const date = String(body.date ?? "");
    const startTime = String(body.startTime ?? "").slice(0, 5);
    if (!isDate(date) || !isTime(startTime)) {
      return NextResponse.json({ ok: false, error: "invalid_input" }, { status: 422 });
    }
    const result = await store.rescheduleBooking(reference, date, startTime, "admin");
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error, message: ERROR_MESSAGES[result.error] }, { status: 409 });
    }
    dispatchSoon();
    return NextResponse.json({ ok: true, booking: forAdmin(result.booking) });
  }

  if (action === "status") {
    const status = String(body.status ?? "") as BookingStatus;
    if (!BOOKING_STATUSES.includes(status)) {
      return NextResponse.json({ ok: false, error: "invalid_input" }, { status: 422 });
    }
    const note = typeof body.note === "string" ? body.note.slice(0, 1000) : undefined;
    const result = status === "cancelled"
      ? await store.cancelBooking(reference, "admin", undefined, note)
      : await store.setBookingStatus(reference, status, note);
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error, message: ERROR_MESSAGES[result.error] }, { status: 400 });
    }
    dispatchSoon();
    return NextResponse.json({ ok: true, booking: forAdmin(result.booking) });
  }

  return NextResponse.json({ ok: false, error: "unknown_action" }, { status: 400 });
}
