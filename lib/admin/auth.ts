import "server-only";
import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { env, hasAdminAuth } from "@/lib/env";

/* ----------------------------------------------------------------------------
   Admin authentication.

   A signed, HttpOnly session cookie issued against ADMIN_PASSWORD. No admin
   credential is ever sent to the browser, and the cookie carries only an
   issue time and a signature, so it cannot be edited into a longer session.

   This is deliberately small. To move to Supabase Auth later, replace
   `signIn` and `readSession`; everything else calls `requireAdmin()`.
---------------------------------------------------------------------------- */

export const ADMIN_COOKIE = "vip_admin";
const MAX_AGE_SECONDS = 60 * 60 * 12;

const secret = () => env.adminSessionSecret ?? "";

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function issueSession(): string {
  const payload = `${Date.now()}.${randomBytes(9).toString("base64url")}`;
  return `${payload}.${sign(payload)}`;
}

export function verifySession(token: string | undefined): boolean {
  if (!token || !hasAdminAuth()) return false;
  const idx = token.lastIndexOf(".");
  if (idx < 0) return false;
  const payload = token.slice(0, idx);
  const signature = token.slice(idx + 1);
  if (!safeEqual(signature, sign(payload))) return false;

  const issued = Number(payload.split(".")[0]);
  if (!Number.isFinite(issued)) return false;
  return Date.now() - issued < MAX_AGE_SECONDS * 1000;
}

/** Constant-time password check, so a wrong guess leaks no timing signal. */
export function passwordMatches(candidate: string): boolean {
  if (!hasAdminAuth()) return false;
  const expected = env.adminPassword!;
  // Hash both sides first: timingSafeEqual needs equal lengths, and hashing
  // avoids leaking the password's length through the comparison.
  return safeEqual(sign(`pw:${candidate}`), sign(`pw:${expected}`));
}

export const sessionCookieOptions = {
  httpOnly: true as const,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: MAX_AGE_SECONDS,
};

/** For server components. */
export async function isAdminAuthenticated(): Promise<boolean> {
  const jar = await cookies();
  return verifySession(jar.get(ADMIN_COOKIE)?.value);
}

/**
 * Audit reference of the current admin session: a short one-way hash of the session cookie, so events can tell
 * sessions apart without storing anything that could be replayed. Null when not signed in.
 */
export async function adminActorRef(): Promise<string | null> {
  const jar = await cookies();
  const token = jar.get(ADMIN_COOKIE)?.value;
  if (!token || !verifySession(token)) return null;
  return `admin:${createHmac("sha256", "vip-admin-actor").update(token).digest("hex").slice(0, 12)}`;
}

/** For route handlers, which read the cookie off the request. */
export function isAdminRequest(req: Request): boolean {
  const header = req.headers.get("cookie") ?? "";
  const match = header.split(";").map((c) => c.trim()).find((c) => c.startsWith(`${ADMIN_COOKIE}=`));
  return verifySession(match?.slice(ADMIN_COOKIE.length + 1));
}
