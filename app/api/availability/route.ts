import { NextResponse } from "next/server";
import { getBookingStore } from "@/lib/booking";
import { addDays, businessToday } from "@/lib/booking/time";
import { isDate } from "@/lib/booking/validation";
import { clientKey, rateLimit } from "@/lib/booking/rate-limit";

export const dynamic = "force-dynamic";

/* GET /api/availability?property=<slug>&from=<date>&to=<date>
   Open slots only. Returns nothing about who booked the rest. */
export async function GET(req: Request) {
  if (!rateLimit(clientKey(req, "availability"), 120, 60_000)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const url = new URL(req.url);
  const property = url.searchParams.get("property");
  if (!property) return NextResponse.json({ error: "missing_property" }, { status: 400 });

  const today = businessToday();
  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");
  const from = isDate(fromParam) && fromParam >= today ? fromParam : today;
  const to = isDate(toParam) ? toParam : addDays(from, 41);

  // Cap the span so one request cannot ask for years of slots.
  const span = Math.min(Math.max(Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`), 0) / 86_400_000, 92);

  const store = getBookingStore();
  const record = await store.getProperty(property);
  if (!record) return NextResponse.json({ error: "property_not_found" }, { status: 404 });

  const days = await store.availability(property, from, addDays(from, span));

  return NextResponse.json({
    property: {
      slug: record.slug,
      title: record.title,
      location: record.location,
      address: record.address,
      type: record.propertyType,
      viewingMode: record.viewingMode,
      durationMinutes: record.viewingDurationMinutes,
    },
    timezone: "Asia/Yerevan",
    from,
    to: addDays(from, span),
    days: days.map((d) => ({ date: d.date, slots: d.slots.map((s) => ({ start: s.startTime, end: s.endTime })) })),
    storeKind: store.kind,
  }, { headers: { "cache-control": "no-store" } });
}
