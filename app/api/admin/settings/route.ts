import { NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/admin/auth";
import { getBookingStore } from "@/lib/booking";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!isAdminRequest(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const num = (k: string, min: number, max: number) => {
    const v = Number(body[k]);
    return Number.isFinite(v) && v >= min && v <= max ? v : undefined;
  };

  await getBookingStore().saveSettings({
    minLeadMinutes: num("minLeadMinutes", 0, 10_080),
    maxDaysAhead: num("maxDaysAhead", 1, 365),
    defaultSlotMinutes: num("defaultSlotMinutes", 15, 480),
    reminderHoursBefore: num("reminderHoursBefore", 1, 168),
    autoCancelUnconfirmed: typeof body.autoCancelUnconfirmed === "boolean" ? body.autoCancelUnconfirmed : undefined,
  });

  return NextResponse.json({ ok: true });
}
