import { NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/admin/auth";
import { getBookingStore } from "@/lib/booking";
import { isDate, isTime } from "@/lib/booking/validation";

export const dynamic = "force-dynamic";

const unauthorized = () => NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

/* The availability screen edits three things, all through here:
   recurring weekly rules, per-date slot overrides, and blackouts. */
export async function POST(req: Request) {
  if (!isAdminRequest(req)) return unauthorized();

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const store = getBookingStore();
  const kind = String(body.kind ?? "");
  const action = String(body.action ?? "save");
  const propertySlug = body.propertySlug ? String(body.propertySlug) : null;

  try {
    if (kind === "rule") {
      if (action === "delete") {
        await store.deleteRule(String(body.id));
      } else {
        const weekday = Number(body.weekday);
        const startTime = String(body.startTime ?? "").slice(0, 5);
        const endTime = String(body.endTime ?? "").slice(0, 5);
        const slotMinutes = Number(body.slotMinutes ?? 90);
        if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) throw new Error("weekday");
        if (!isTime(startTime) || !isTime(endTime) || endTime <= startTime) throw new Error("times");
        if (!Number.isInteger(slotMinutes) || slotMinutes < 15 || slotMinutes > 480) throw new Error("slot");
        await store.saveRule({
          id: body.id ? String(body.id) : undefined,
          propertySlug, weekday, startTime, endTime, slotMinutes,
          isActive: body.isActive !== false,
        });
      }
    } else if (kind === "blackout") {
      if (action === "delete") {
        await store.deleteBlackout(String(body.id));
      } else {
        const date = String(body.date ?? "");
        if (!isDate(date)) throw new Error("date");
        const startTime = body.startTime ? String(body.startTime).slice(0, 5) : null;
        const endTime = body.endTime ? String(body.endTime).slice(0, 5) : null;
        if (startTime && !isTime(startTime)) throw new Error("time");
        await store.addBlackout({
          propertySlug, date, startTime, endTime,
          reason: body.reason ? String(body.reason).slice(0, 200) : undefined,
        });
      }
    } else if (kind === "override") {
      if (action === "delete") {
        await store.deleteDateOverride(String(body.id));
      } else {
        const date = String(body.date ?? "");
        const startTime = String(body.startTime ?? "").slice(0, 5);
        const endTime = String(body.endTime ?? "").slice(0, 5);
        if (!isDate(date) || !isTime(startTime) || !isTime(endTime)) throw new Error("input");
        await store.saveDateOverride({
          propertySlug, date, startTime, endTime,
          isAvailable: body.isAvailable !== false,
          note: body.note ? String(body.note).slice(0, 200) : undefined,
        });
      }
    } else if (kind === "property") {
      const mode = String(body.mode ?? "standard") as "standard" | "appointment_only" | "unavailable";
      if (!propertySlug) throw new Error("property");
      await store.setPropertyViewingMode(propertySlug, mode, body.durationMinutes ? Number(body.durationMinutes) : undefined);
    } else {
      return NextResponse.json({ ok: false, error: "unknown_kind" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_input" }, { status: 422 });
  }

  return NextResponse.json({ ok: true });
}
