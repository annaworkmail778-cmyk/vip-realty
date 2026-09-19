import "server-only";
import { parsePasswordHash } from "@/lib/admin/password";

/* ----------------------------------------------------------------------------
   Server-side configuration.

   Importing this module from a client component is a build error, which is the
   point: the service-role key and the admin credentials must never be bundled
   into anything the browser downloads. Only NEXT_PUBLIC_* values may be read
   outside this file.

   Production policy (fail closed): admin sign-in is disabled unless
   ADMIN_SESSION_SECRET has at least 32 characters and ADMIN_PASSWORD_HASH holds
   a valid scrypt hash. A plaintext ADMIN_PASSWORD is accepted only outside
   production (local development). `npm run check:config` reports the same rules
   by variable name without printing values.
---------------------------------------------------------------------------- */

const read = (key: string) => {
  const v = process.env[key];
  return v && v.trim() ? v.trim() : undefined;
};

export const isProduction = process.env.NODE_ENV === "production";

export const env = {
  supabaseUrl: read("NEXT_PUBLIC_SUPABASE_URL"),
  /** Service-role key. Server-only; used by the admin area to read unpublished listings. */
  supabaseServiceKey: read("SUPABASE_SERVICE_ROLE_KEY"),
  /** Publishable (anon) key. Used only server-side, for RLS-protected public reads and inquiries. */
  supabasePublishableKey: read("SUPABASE_PUBLISHABLE_KEY"),

  /** scrypt hash of the admin password (required in production). */
  adminPasswordHash: read("ADMIN_PASSWORD_HASH"),
  /** Plaintext admin password — local development only; ignored in production. */
  adminPassword: isProduction ? undefined : read("ADMIN_PASSWORD"),
  adminSessionSecret: read("ADMIN_SESSION_SECRET"),
};

/** True when the service-role (admin) database client can be created. */
export const hasSupabase = () => Boolean(env.supabaseUrl && env.supabaseServiceKey);

/** True when public listings can be read from Supabase. */
export const hasPublicSupabase = () => Boolean(env.supabaseUrl && env.supabasePublishableKey);

const MIN_SESSION_SECRET = 32;

/** The admin credential in force: a valid hash wins; plaintext only outside production. */
export function adminCredential(): { kind: "hash"; value: string } | { kind: "plain"; value: string } | null {
  if (env.adminPasswordHash && parsePasswordHash(env.adminPasswordHash)) return { kind: "hash", value: env.adminPasswordHash };
  if (!isProduction && env.adminPassword) return { kind: "plain", value: env.adminPassword };
  return null;
}

/** True when the admin panel can authenticate anyone (otherwise sign-in is refused: fail closed). */
export const hasAdminAuth = () =>
  Boolean(adminCredential() && env.adminSessionSecret && env.adminSessionSecret.length >= MIN_SESSION_SECRET);
