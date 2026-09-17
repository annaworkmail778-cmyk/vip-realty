"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { EVENT_LABELS, type NotificationEventName } from "@/lib/notifications/events";
import type { NotificationEvent } from "@/lib/booking/types";

/* ----------------------------------------------------------------------------
   The notification outbox.

   Events are recorded whether or not a channel is connected, so nothing is
   lost while Telegram is being set up — connect it, press Retry, and the
   backlog goes out.
---------------------------------------------------------------------------- */

const STATUS_TONE: Record<string, string> = {
  sent: "text-champagne",
  queued: "text-ivory/70",
  failed: "text-ivory/90",
  skipped: "text-ivory/35",
};

export function NotificationsPanel({
  events, telegramReady,
}: { events: NotificationEvent[]; telegramReady: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function act(action: "flush" | "test") {
    setBusy(action);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/notifications", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const body = await res.json();
      setMessage(
        action === "test"
          ? body.ok ? "Test message sent to Telegram." : `Test failed: ${body.error ?? "unknown error"}`
          : `Delivered ${body.sent ?? 0}, failed ${body.failed ?? 0}, skipped ${body.skipped ?? 0}.`,
      );
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  const queued = events.filter((e) => e.status === "queued").length;

  return (
    <div className="mt-8">
      {!telegramReady && (
        <div className="border border-champagne/30 bg-champagne/5 p-5">
          <p className="label text-champagne">Telegram not configured</p>
          <p className="mt-3 max-w-[62ch] text-[0.88rem] leading-relaxed text-ivory/70">
            Set <code className="text-champagne">TELEGRAM_BOT_TOKEN</code> and{" "}
            <code className="text-champagne">TELEGRAM_CHAT_ID</code> on the server, then restart.
            Events keep queueing until then, so nothing is missed.
          </p>
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => act("flush")}
          className="label border border-ivory/25 px-4 py-2.5 text-ivory/80 transition-colors hover:border-champagne hover:text-champagne disabled:opacity-40"
        >
          {busy === "flush" ? "Sending…" : `Retry queued (${queued})`}
        </button>
        <button
          type="button"
          disabled={busy !== null || !telegramReady}
          onClick={() => act("test")}
          className="label border border-ivory/25 px-4 py-2.5 text-ivory/80 transition-colors hover:border-champagne hover:text-champagne disabled:opacity-30"
        >
          Send test message
        </button>
        {message && <p className="label text-ivory/60">{message}</p>}
      </div>

      <div className="mt-8 overflow-x-auto">
        <table className="w-full min-w-[44rem] border-collapse text-left">
          <thead>
            <tr className="border-b border-ivory/15">
              {["Event", "Booking", "Channel", "Status", "Detail", "When"].map((h) => (
                <th key={h} className="label py-3 pr-4 font-normal text-ivory/35">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {events.length === 0 && (
              <tr><td colSpan={6} className="label py-10 text-ivory/25">No notifications yet.</td></tr>
            )}
            {events.map((e) => (
              <tr key={e.id} className="border-b border-ivory/8">
                <td className="py-3.5 pr-4 text-[0.9rem] text-ivory">
                  {EVENT_LABELS[e.event as NotificationEventName] ?? e.event}
                </td>
                <td className="label py-3.5 pr-4 text-champagne">{e.bookingReference ?? "—"}</td>
                <td className="label py-3.5 pr-4 text-ivory/45">{e.channel}</td>
                <td className={`label py-3.5 pr-4 ${STATUS_TONE[e.status]}`}>{e.status}</td>
                <td className="label max-w-[22rem] truncate py-3.5 pr-4 text-ivory/35">{e.lastError ?? "—"}</td>
                <td className="label py-3.5 pr-4 text-ivory/35">{new Date(e.createdAt).toLocaleString("en-GB")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
