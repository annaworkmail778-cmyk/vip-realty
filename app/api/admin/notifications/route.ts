import { NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/admin/auth";
import { dispatchPending } from "@/lib/notifications/dispatch";
import { sendTelegram } from "@/lib/notifications/telegram";
import { hasTelegram } from "@/lib/env";

export const dynamic = "force-dynamic";

/* POST { action: "flush" | "test" } — retry the outbox, or prove the Telegram
   credentials work without creating a fake booking. */
export async function POST(req: Request) {
  if (!isAdminRequest(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const action = String((body as { action?: string }).action ?? "flush");

  if (action === "test") {
    if (!hasTelegram()) {
      return NextResponse.json({ ok: false, error: "Telegram is not configured on the server." }, { status: 503 });
    }
    const result = await sendTelegram({
      heading: "🔔 APEX REALTY TEST",
      lines: [
        { label: "Message", value: "Telegram notifications are connected." },
        { label: "Sent", value: new Date().toISOString() },
      ],
    });
    return NextResponse.json({ ok: result.ok, error: result.error }, { status: result.ok ? 200 : 502 });
  }

  const result = await dispatchPending(50);
  return NextResponse.json({ ok: true, ...result });
}
