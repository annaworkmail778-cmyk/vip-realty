import { NextResponse } from "next/server";
import { ADMIN_COOKIE, sessionCookieOptions } from "@/lib/admin/auth";
import { isCrossSite } from "@/lib/security/origin";

export const dynamic = "force-dynamic";

/* Clears this browser's session cookie. A copied cookie stays valid until it expires (12 h) unless the secret or
   the password is rotated — see docs/rebuild/phase-09-production-hardening-e2e.md, "Admin sessions". */
export async function POST(req: Request) {
  if (isCrossSite(req)) return NextResponse.json({ ok: false }, { status: 403 });
  const res = NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  res.cookies.set(ADMIN_COOKIE, "", { ...sessionCookieOptions, maxAge: 0 });
  return res;
}
