import { getBookingStore } from "@/lib/booking";
import { icsStamp, slotInstant } from "@/lib/booking/time";
import { isReference, isUuid } from "@/lib/booking/validation";
import { site } from "@/lib/site";

export const dynamic = "force-dynamic";

/* GET /api/bookings/<reference>/calendar?token=<uuid> → .ics
   Written server-side rather than in the browser so the times come from the
   stored booking, not from whatever timezone the visitor's device is in. */
export async function GET(req: Request, ctx: { params: Promise<{ reference: string }> }) {
  const { reference } = await ctx.params;
  const token = new URL(req.url).searchParams.get("token");

  if (!isReference(reference) || !isUuid(token)) return new Response("Not found", { status: 404 });

  const booking = await getBookingStore().getBooking(reference, token);
  if (!booking) return new Response("Not found", { status: 404 });

  const start = slotInstant(booking.date, booking.startTime);
  const end = slotInstant(booking.date, booking.endTime);
  const location = booking.propertyAddress ?? booking.propertyLocation;

  const escape = (s: string) => s.replace(/([,;\\])/g, "\\$1").replace(/\n/g, "\\n");

  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//VIP Realty//Viewings//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${booking.reference}@vip-realty`,
    `DTSTAMP:${icsStamp(new Date())}`,
    `DTSTART:${icsStamp(start)}`,
    `DTEND:${icsStamp(end)}`,
    `SUMMARY:${escape(`Viewing — ${booking.propertyTitle}`)}`,
    `LOCATION:${escape(location)}`,
    `DESCRIPTION:${escape(`${site.legalName} private viewing.\nBooking ${booking.reference}.\n${site.contact.phone}`)}`,
    "BEGIN:VALARM",
    "TRIGGER:-PT2H",
    "ACTION:DISPLAY",
    `DESCRIPTION:${escape(`Viewing today — ${booking.propertyTitle}`)}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  return new Response(ics, {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": `attachment; filename="vip-realty-${booking.reference}.ics"`,
      "cache-control": "no-store",
    },
  });
}
