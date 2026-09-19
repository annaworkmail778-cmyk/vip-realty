import "server-only";
import { createHash, createHmac, timingSafeEqual, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { verifyPassword } from "@/lib/admin/password";
import { adminCredential, env, hasAdminAuth, isProduction } from "@/lib/env";

/* ----------------------------------------------------------------------------
   Admin authentication (single shared admin credential).

   * Credential: ADMIN_PASSWORD_HASH (scrypt) — required in production; a
     plaintext ADMIN_PASSWORD is accepted only in local development.
   * Session: a signed, HttpOnly, SameSite=Lax cookie carrying only an issue
     time and a random nonce. `__Host-` prefixed and Secure in production.
     Absolute lifetime 12 h; future-dated tokens are refused.
   * The signing key is derived from ADMIN_SESSION_SECRET **and** a fingerprint
     of the credential: rotating either the secret or the password invalidates
     every existing session (the documented "sign everyone out" procedure).
   * Fails closed: without a production-grade configuration nobody can sign in.

   To move to per-user accounts later, replace `passwordMatches`,
   `issueSession` and `verifySession`; callers only use the helpers below.
---------------------------------------------------------------------------- */

export const ADMIN_COOKIE = isProduction ? "__Host-vip_admin" : "vip_admin";
const MAX_AGE_SECONDS = 60 * 60 * 12;
const CLOCK_SKEW_MS = 60_000;

function signingKey(): string {
  const credential = adminCredential();
  const fingerprint = credential ? createHash("sha256").update(`${credential.kind}:${credential.value}`).digest("base64url") : "";
  return `${env.adminSessionSecret ?? ""}|${fingerprint}`;
}

function sign(payload: string): string {
  return createHmac("sha256", signingKey()).update(payload).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function issueSession(): string {
  const payload = `${Date.now()}.${randomBytes(16).toString("base64url")}`;
  return `${payload}.${sign(payload)}`;
}

export function verifySession(token: string | undefined): boolean {
  if (!token || token.length > 300 || !hasAdminAuth()) return false;
  const idx = token.lastIndexOf(".");
  if (idx < 0) return false;
  const payload = token.slice(0, idx);
  const signature = token.slice(idx + 1);
  if (!safeEqual(signature, sign(payload))) return false;

  const issued = Number(payload.split(".")[0]);
  if (!Number.isFinite(issued)) return false;
  const age = Date.now() - issued;
  return age > -CLOCK_SKEW_MS && age < MAX_AGE_SECONDS * 1000;
}

/** Constant-time password check against the configured credential. Never logs the candidate. */
export function passwordMatches(candidate: string): boolean {
  if (!hasAdminAuth() || candidate.length === 0 || candidate.length > 1024) return false;
  const credential = adminCredential()!;
  if (credential.kind === "hash") return verifyPassword(candidate, credential.value);
  // development only: hash both sides so the comparison is constant-time and length-independent
  return safeEqual(sign(`pw:${candidate}`), sign(`pw:${credential.value}`));
}

export const sessionCookieOptions = {
  httpOnly: true as const,
  sameSite: "lax" as const,
  secure: isProduction,
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
