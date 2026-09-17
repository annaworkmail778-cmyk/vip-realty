import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env, hasSupabase } from "@/lib/env";

/* ----------------------------------------------------------------------------
   Service-role Supabase client.

   Every table in the viewing system has RLS on with no policies for anon, so
   this client is the only way in. It exists solely on the server: route
   handlers, server components and the reminder job.
---------------------------------------------------------------------------- */

let client: SupabaseClient | null = null;

export function supabaseAdmin(): SupabaseClient | null {
  if (!hasSupabase()) return null;
  client ??= createClient(env.supabaseUrl!, env.supabaseServiceKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { "x-application": "vip-realty-viewings" } },
  });
  return client;
}
