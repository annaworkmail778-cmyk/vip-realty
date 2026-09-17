import { NextResponse } from "next/server";
import { ADMIN_COOKIE, issueSession, passwordMatches, sessionCookieOptions } from "@/lib/admin/auth";
import { hasAdminAuth } from "@/lib/env";
import { clientKey, rateLimit } from "@/lib/booking/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  // Five attempts a minute per address: enough for a typo, useless for a
  // dictionary run.
  if (!rateLimit(clientKey(req, "admin-login"), 5, 60_000)) {
    return NextResponse.json({ ok: false, error: "Too many attempts. Try again shortly." }, { status: 429 });
  }
  if (!hasAdminAuth()) {
    return NextResponse.json(
      { ok: false, error: "Admin sign-in is not configured. Set ADMIN_PASSWORD and ADMIN_SESSION_SECRET." },
      { status: 503 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const password = typeof (body as { password?: string }).password === "string" ? (body as { password: string }).password : "";

  if (!passwordMatches(password)) {
    return NextResponse.json({ ok: false, error: "Incorrect password." }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, issueSession(), sessionCookieOptions);
  return res;
}
