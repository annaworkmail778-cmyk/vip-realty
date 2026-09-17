import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env, hasSupabase } from "@/lib/env";

/* ----------------------------------------------------------------------------
   Service-role Supabase client.

   Bypasses RLS, so it is used only behind the authenticated admin area (to see
   draft and unpublished listings). It exists solely on the server and is never
   used for public pages, which read through lib/supabase/public.ts instead.
---------------------------------------------------------------------------- */

let client: SupabaseClient | null = null;

export function supabaseAdmin(): SupabaseClient | null {
  if (!hasSupabase()) return null;
  client ??= createClient(env.supabaseUrl!, env.supabaseServiceKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: { "x-application": "vip-realty-admin" },
      fetch: (input, init) => fetch(input, { ...init, cache: "no-store", signal: init?.signal ?? AbortSignal.timeout(8_000) }),
    },
  });
  return client;
}
