import { NextResponse } from "next/server";
import { getBookingStore } from "@/lib/booking";
import { isReference, isUuid } from "@/lib/booking/validation";

export const dynamic = "force-dynamic";

/* GET /api/bookings/<reference>?token=<uuid>
   The token is required: a reference on its own reveals nothing, so guessing
   VIP-2026-00042 gets an attacker a 404 rather than someone's phone number. */
export async function GET(req: Request, ctx: { params: Promise<{ reference: string }> }) {
  const { reference } = await ctx.params;
  const token = new URL(req.url).searchParams.get("token");

  if (!isReference(reference) || !isUuid(token)) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }

  const booking = await getBookingStore().getBooking(reference, token);
  if (!booking) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });

  return NextResponse.json({
    ok: true,
    booking: {
      reference: booking.reference,
      property: {
        title: booking.propertyTitle,
        location: booking.propertyLocation,
        address: booking.propertyAddress,
        slug: booking.propertySlug,
      },
      date: booking.date,
      startTime: booking.startTime,
      endTime: booking.endTime,
      status: booking.status,
      confirmationStatus: booking.confirmationStatus,
      customerName: booking.customerName,
    },
  }, { headers: { "cache-control": "no-store" } });
}
