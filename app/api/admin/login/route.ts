import { NextResponse } from "next/server";
import { ADMIN_COOKIE, issueSession, passwordMatches, sessionCookieOptions } from "@/lib/admin/auth";
import { hasAdminAuth } from "@/lib/env";
import { isCrossSite } from "@/lib/security/origin";
import { clientKey, rateLimit } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 2_048;
const FAILURE_DELAY_MS = 500;

const json = (status: number, body: Record<string, unknown>) =>
  NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });

export async function POST(req: Request) {
  if (isCrossSite(req)) return json(403, { ok: false, error: "Sign-in must come from this site." });

  // Per address: enough for a typo, useless for a dictionary run. Globally: a hard ceiling that still holds when
  // an attacker rotates (spoofable) forwarding headers.
  if (!rateLimit(clientKey(req, "admin-login"), 5, 60_000) || !rateLimit("admin-login:all", 30, 60_000)) {
    return json(429, { ok: false, error: "Too many attempts. Try again shortly." });
  }
  if (!hasAdminAuth()) {
    // Fail closed. Never say which setting is missing to an anonymous caller; `npm run check:config` does.
    return json(503, { ok: false, error: "Admin sign-in is not configured on this server." });
  }

  const raw = await req.text().catch(() => "");
  let password = "";
  if (raw.length > 0 && raw.length <= MAX_BODY_BYTES) {
    try {
      const body = JSON.parse(raw) as { password?: unknown };
      if (typeof body?.password === "string") password = body.password;
    } catch {
      password = "";
    }
  }

  if (!passwordMatches(password)) {
    // Nothing about the attempt is logged; a fixed delay slows guessing further.
    await new Promise((r) => setTimeout(r, FAILURE_DELAY_MS));
    return json(401, { ok: false, error: "Incorrect password." });
  }

  const res = json(200, { ok: true });
  res.cookies.set(ADMIN_COOKIE, issueSession(), sessionCookieOptions);
  return res;
}
