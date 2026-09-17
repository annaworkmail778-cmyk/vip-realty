import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env, hasPublicSupabase } from "@/lib/env";

/* ----------------------------------------------------------------------------
   Least-privilege Supabase client for the public website.

   Uses the publishable key, so every read goes through RLS and column grants:
   it can see published listings and their images, and nothing else. It never
   needs the service-role key, and it lives only on the server — the browser
   receives rendered HTML and plain listing data, never a client or a key.

   Every request is uncached (`cache: "no-store"`) so a listing published by
   automation is visible on the next page load, and bounded by a timeout so an
   unreachable database degrades the page instead of hanging it.
---------------------------------------------------------------------------- */

const REQUEST_TIMEOUT_MS = 8_000;

let client: SupabaseClient | null = null;

export function supabasePublic(): SupabaseClient | null {
  if (!hasPublicSupabase()) return null;
  client ??= createClient(env.supabaseUrl!, env.supabasePublishableKey!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      headers: { "x-application": "vip-realty-website" },
      fetch: (input, init) =>
        fetch(input, {
          ...init,
          cache: "no-store",
          signal: init?.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        }),
    },
  });
  return client;
}
