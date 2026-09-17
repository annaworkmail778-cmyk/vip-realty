import "server-only";
import { getBookingStore } from "@/lib/booking";
import { renderMessage, type NotificationEventName } from "./events";
import { sendTelegram } from "./telegram";
import type { Booking } from "@/lib/booking/types";

/* ----------------------------------------------------------------------------
   Outbox dispatch.

   Events are written to the database in the same transaction as the change
   that caused them, then delivered from here. A booking is therefore never
   lost because Telegram was unreachable, and a failed send can be retried
   without re-creating anything.

   To add a channel: implement it like `sendTelegram`, then route to it on the
   event's `channel` field. Nothing else changes.
---------------------------------------------------------------------------- */

export async function dispatchPending(limit = 20): Promise<{ sent: number; failed: number; skipped: number }> {
  const store = getBookingStore();
  const queued = await store.claimQueuedNotifications(limit);
  let sent = 0, failed = 0, skipped = 0;

  for (const event of queued) {
    const booking = event.bookingReference
      ? await store.getBooking(event.bookingReference)
      : null;

    if (!booking) {
      await store.markNotification(event.id, "skipped", "Booking no longer exists");
      skipped++;
      continue;
    }

    const message = renderMessage(event.event as NotificationEventName, booking as Booking, event.payload);

    // Only the agency Telegram channel is wired up. Customer-facing channels
    // (email, SMS, WhatsApp) are recorded and left queued-then-skipped until
    // one is connected, so nothing silently disappears.
    const result = event.channel === "telegram"
      ? await sendTelegram(message)
      : { ok: false, skipped: true, error: `No provider connected for '${event.channel}'` };

    if (result.ok) { await store.markNotification(event.id, "sent"); sent++; }
    else if (result.skipped) { await store.markNotification(event.id, "skipped", result.error); skipped++; }
    else { await store.markNotification(event.id, "failed", result.error); failed++; }
  }

  return { sent, failed, skipped };
}

/**
 * Called after a mutation so the agency hears about it promptly. Deliberately
 * not awaited by request handlers: a slow Telegram call must never delay a
 * customer's confirmation screen.
 */
export function dispatchSoon(): void {
  void dispatchPending().catch((e) => {
    console.error("[notifications] dispatch failed", e);
  });
}
