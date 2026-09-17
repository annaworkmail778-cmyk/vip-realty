// ---------------------------------------------------------------------------
// Supabase Edge Function: viewing-reminders
//
// Queues 24-hour customer reminders, expires stale confirmations, and pushes
// the notification outbox to Telegram. Scheduled by pg_cron (see
// supabase/migrations/20260912090300_cron.sql), so it runs whether or not
// anybody has the website open.
//
//   supabase functions deploy viewing-reminders
//   supabase secrets set TELEGRAM_BOT_TOKEN=... TELEGRAM_CHAT_ID=...
// ---------------------------------------------------------------------------

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN");
const TELEGRAM_CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID");
const SITE_URL = Deno.env.get("SITE_URL") ?? "https://vip-realty.example";

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const fmtDate = (d: string) =>
  new Intl.DateTimeFormat("en-GB", {
    weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  }).format(new Date(`${d}T12:00:00Z`));

const HEADINGS: Record<string, string> = {
  "booking.created": "🏠 NEW APEX REALTY VIEWING",
  "booking.confirmed": "✅ VIEWING CONFIRMED",
  "booking.cancelled": "❌ VIEWING CANCELLED",
  "booking.rescheduled": "🔁 VIEWING RESCHEDULED",
  "customer.confirmed": "✅ CUSTOMER CONFIRMED",
  "customer.declined": "❌ CUSTOMER CANCELLED",
  "customer.not_confirmed": "⚠️ NOT CONFIRMED BY CUSTOMER",
  "viewing.completed": "🏁 VIEWING COMPLETED",
  "viewing.no_show": "🚫 NO-SHOW",
  "reminder.customer": "⏰ REMINDER DUE",
};

async function sendTelegram(text: string) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    return { ok: false, skipped: true, error: "Telegram not configured" };
  }
  const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID, text, parse_mode: "HTML", disable_web_page_preview: true,
    }),
  });
  if (!res.ok) return { ok: false, error: `Telegram ${res.status}` };
  return { ok: true };
}

Deno.serve(async (req) => {
  // pg_cron passes the service key; nothing else may invoke this.
  const auth = req.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${SERVICE_KEY}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { data: settings } = await db.from("viewing_settings").select("value").eq("key", "booking").maybeSingle();
  const hours = (settings?.value?.reminder_hours_before as number) ?? 24;

  const { data: queued } = await db.rpc("queue_viewing_reminders", { p_window_hours: hours });
  const { data: expired } = await db.rpc("expire_viewing_confirmations");

  const { data: events } = await db
    .from("notification_events")
    .select("*, viewing_bookings(*, properties(title, address, location))")
    .eq("status", "queued")
    .limit(50);

  let sent = 0, failed = 0, skipped = 0;

  for (const event of events ?? []) {
    const b = event.viewing_bookings;
    if (!b) {
      await db.from("notification_events")
        .update({ status: "skipped", last_error: "Booking no longer exists" }).eq("id", event.id);
      skipped++;
      continue;
    }

    const manageUrl = `${SITE_URL}/viewings/${b.booking_reference}?token=${b.manage_token}`;
    const lines = [
      ["Property", b.properties?.title ?? "—"],
      ["Location", b.properties?.address ?? b.properties?.location ?? "—"],
      ["Customer", b.customer_name],
      ["Phone", b.customer_phone],
      ["Email", b.customer_email],
      ["Date", fmtDate(b.viewing_date)],
      ["Time", `${String(b.viewing_start_time).slice(0, 5)} (Yerevan)`],
      ["Status", b.status === "pending" ? "Pending confirmation" : b.status],
      ["Booking", b.booking_reference],
    ];

    // The customer reminder is an agency-side alert until an email or SMS
    // provider is connected; the manage link is what the customer will get.
    if (event.event === "reminder.customer") lines.push(["Customer link", manageUrl]);

    const text = `<b>${escapeHtml(HEADINGS[event.event] ?? event.event)}</b>\n\n` +
      lines.map(([k, v]) => `<b>${escapeHtml(k)}:</b>\n${escapeHtml(String(v))}`).join("\n\n");

    const result = await sendTelegram(text);
    const status = result.ok ? "sent" : result.skipped ? "skipped" : "failed";
    await db.from("notification_events").update({
      status,
      attempts: (event.attempts ?? 0) + 1,
      last_error: result.error ?? null,
      delivered_at: result.ok ? new Date().toISOString() : null,
    }).eq("id", event.id);

    if (result.ok) sent++;
    else if (result.skipped) skipped++;
    else failed++;
  }

  return Response.json({
    ok: true, queued: queued ?? 0, expired: expired ?? 0, sent, failed, skipped,
  });
});
