import "server-only";
import { env, hasTelegram } from "@/lib/env";
import type { RenderedMessage } from "./events";

/* ----------------------------------------------------------------------------
   Telegram delivery.

   The bot token is read only here, only on the server, and is never sent to
   the browser or written into a notification record. When the token is absent
   the channel reports itself unconfigured and events are marked 'skipped'
   rather than lost.
---------------------------------------------------------------------------- */

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function formatForTelegram(msg: RenderedMessage): string {
  const body = msg.lines
    .map((l) => `<b>${escapeHtml(l.label)}:</b>\n${escapeHtml(l.value)}`)
    .join("\n\n");
  return `<b>${escapeHtml(msg.heading)}</b>\n\n${body}${msg.footer ? `\n\n${escapeHtml(msg.footer)}` : ""}`;
}

export interface DeliveryResult {
  ok: boolean;
  skipped?: boolean;
  error?: string;
}

export async function sendTelegram(msg: RenderedMessage): Promise<DeliveryResult> {
  if (!hasTelegram()) {
    return { ok: false, skipped: true, error: "Telegram is not configured" };
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${env.telegramBotToken}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: env.telegramChatId,
        text: formatForTelegram(msg),
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
    if (!res.ok) {
      const detail = await res.text();
      // Never echo the URL back: it contains the bot token.
      return { ok: false, error: `Telegram responded ${res.status}: ${detail.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Telegram request failed" };
  }
}
