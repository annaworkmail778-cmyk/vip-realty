import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/* ----------------------------------------------------------------------------
   Admin password hashing (scrypt, Node built-in, no dependencies).

   Stored format (ADMIN_PASSWORD_HASH):  scrypt:<N>:<r>:<p>:<salt base64url>:<key base64url>
   `:` separators on purpose: `$` would be expanded by .env loaders (Next.js expands `$VAR`, even in quotes).
   Generate one with `npm run admin:hash-password` (reads the password from stdin).
   Imported only by server modules (lib/admin/auth.ts, scripts); no secrets here.
---------------------------------------------------------------------------- */

const KEY_LENGTH = 32;
const DEFAULT = { N: 16384, r: 8, p: 1 };
const FORMAT = /^scrypt:(\d{4,7}):(\d{1,2}):(\d{1,2}):([A-Za-z0-9_-]{16,}):([A-Za-z0-9_-]{40,})$/;

export interface ParsedHash { N: number; r: number; p: number; salt: Buffer; key: Buffer }

export function parsePasswordHash(value: string | undefined | null): ParsedHash | null {
  const m = typeof value === "string" ? value.trim().match(FORMAT) : null;
  if (!m) return null;
  const N = Number(m[1]), r = Number(m[2]), p = Number(m[3]);
  // N must be a power of two; bounds keep verification cheap enough and brute force expensive enough.
  if (N < 16384 || N > 1048576 || (N & (N - 1)) !== 0 || r < 8 || r > 32 || p < 1 || p > 4) return null;
  const salt = Buffer.from(m[4], "base64url");
  const key = Buffer.from(m[5], "base64url");
  if (salt.length < 16 || key.length !== KEY_LENGTH) return null;
  return { N, r, p, salt, key };
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, KEY_LENGTH, { ...DEFAULT, maxmem: 64 * 1024 * 1024 });
  return `scrypt:${DEFAULT.N}:${DEFAULT.r}:${DEFAULT.p}:${salt.toString("base64url")}:${key.toString("base64url")}`;
}

/** Constant-time verification against a stored hash. False for a malformed hash. */
export function verifyPassword(candidate: string, stored: string): boolean {
  const parsed = parsePasswordHash(stored);
  if (!parsed) return false;
  const derived = scryptSync(candidate, parsed.salt, KEY_LENGTH, {
    N: parsed.N, r: parsed.r, p: parsed.p, maxmem: 256 * 1024 * 1024,
  });
  return timingSafeEqual(derived, parsed.key);
}
