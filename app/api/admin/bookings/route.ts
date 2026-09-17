import { NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/admin/auth";
import { getBookingStore } from "@/lib/booking";
import { ERROR_MESSAGES } from "@/lib/booking/types";
import { isDate, isTime } from "@/lib/booking/validation";
import { dispatchSoon } from "@/lib/notifications/dispatch";

export const dynamic = "force-dynamic";

const unauthorized = () => NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

/* GET — the booking list behind admin auth. Public callers get 401, which is
   what keeps customer contact details off the open internet. */
export async function GET(req: Request) {
  if (!isAdminRequest(req)) return unauthorized();

  const url = new URL(req.url);
  const store = getBookingStore();
  const bookings = await store.listBookings({
    from: isDate(url.searchParams.get("from")) ? url.searchParams.get("from")! : undefined,
    to: isDate(url.searchParams.get("to")) ? url.searchParams.get("to")! : undefined,
    propertySlug: url.searchParams.get("property") ?? undefined,
    search: url.searchParams.get("q") ?? undefined,
    limit: 500,
  });
  return NextResponse.json({ ok: true, bookings }, { headers: { "cache-control": "no-store" } });
}

/* POST — an agent taking a booking over the phone. Same slot rules as the
   public path: the admin cannot double-book either. */
export async function POST(req: Request) {
  if (!isAdminRequest(req)) return unauthorized();

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const get = (k: string) => (typeof body[k] === "string" ? (body[k] as string).trim() : "");

  const propertySlug = get("propertySlug");
  const date = get("date");
  const startTime = get("startTime").slice(0, 5);
  const name = get("name");
  const phone = get("phone");
  const email = get("email") || "no-email@vip-realty.local";

  if (!propertySlug || !isDate(date) || !isTime(startTime) || name.length < 2 || phone.length < 5) {
    return NextResponse.json({ ok: false, error: "invalid_input" }, { status: 422 });
  }

  const result = await getBookingStore().createBooking({
    propertySlug, date, startTime, name, phone, email,
    message: get("message") || undefined,
    consent: true,
    source: "admin",
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error, message: ERROR_MESSAGES[result.error] }, { status: 409 });
  }

  dispatchSoon();
  const { manageToken: _omit, ...booking } = result.booking;
  return NextResponse.json({ ok: true, booking }, { status: 201 });
}
