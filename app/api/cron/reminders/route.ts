import { NextResponse } from "next/server";
import { getBookingStore } from "@/lib/booking";
import { dispatchPending } from "@/lib/notifications/dispatch";
import { env } from "@/lib/env";
import { isAdminRequest } from "@/lib/admin/auth";

export const dynamic = "force-dynamic";

/* ----------------------------------------------------------------------------
   The scheduled job behind the 24-hour reminder.

   Runs server-side on a timer that has nothing to do with anyone having the
   site open. Point Supabase Cron, Vercel Cron or any scheduler at:

     POST /api/cron/reminders
     Authorization: Bearer $CRON_SECRET

   It is idempotent: `reminder_sent_at` means a double-fire cannot send a
   customer two reminders.
---------------------------------------------------------------------------- */

async function run() {
  const store = getBookingStore();
  const settings = await store.getSettings();

  const queued = await store.queueReminders(settings.reminderHoursBefore);
  const expired = await store.expireConfirmations();
  const delivery = await dispatchPending(50);

  return { queued, expired, ...delivery, at: new Date().toISOString() };
}

export async function POST(req: Request) {
  const auth = req.headers.get("authorization");
  const authorised = env.cronSecret
    ? auth === `Bearer ${env.cronSecret}`
    : isAdminRequest(req); // Before a secret is set, only a signed-in admin may trigger it.

  if (!authorised) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  try {
    return NextResponse.json({ ok: true, ...(await run()) });
  } catch (e) {
    console.error("[cron/reminders]", e);
    return NextResponse.json({ ok: false, error: "job_failed" }, { status: 500 });
  }
}

export const GET = POST;
