import "server-only";

/* ----------------------------------------------------------------------------
   Server-side configuration.

   Importing this module from a client component is a build error, which is the
   point: the service-role key and the admin credentials must never be bundled
   into anything the browser downloads. Only NEXT_PUBLIC_* values may be read
   outside this file.
---------------------------------------------------------------------------- */

const read = (key: string) => {
  const v = process.env[key];
  return v && v.trim() ? v.trim() : undefined;
};

export const env = {
  supabaseUrl: read("NEXT_PUBLIC_SUPABASE_URL"),
  /** Service-role key. Server-only; used by the admin area to read unpublished listings. */
  supabaseServiceKey: read("SUPABASE_SERVICE_ROLE_KEY"),
  /** Publishable (anon) key. Used only server-side, for RLS-protected public reads and inquiries. */
  supabasePublishableKey: read("SUPABASE_PUBLISHABLE_KEY"),

  adminPassword: read("ADMIN_PASSWORD"),
  adminSessionSecret: read("ADMIN_SESSION_SECRET"),
};

/** True when the service-role (admin) database client can be created. */
export const hasSupabase = () => Boolean(env.supabaseUrl && env.supabaseServiceKey);

/** True when public listings can be read from Supabase. */
export const hasPublicSupabase = () => Boolean(env.supabaseUrl && env.supabasePublishableKey);

/** True when the admin panel can authenticate anyone. */
export const hasAdminAuth = () => Boolean(env.adminPassword && env.adminSessionSecret);
