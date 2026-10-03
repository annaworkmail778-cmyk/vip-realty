import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { AdminResult } from "@/lib/admin/properties";

/* ----------------------------------------------------------------------------
   Website "request information" inquiries, read-only, for the admin.

   Inquiries are written only by the public `submit_inquiry` database function
   (app/api/inquiries). Visitors' contact details are read here with the service
   role, behind the admin session, and never leave the admin area. There is no
   editing or status workflow yet: staff follow up by phone, WhatsApp or email.
---------------------------------------------------------------------------- */

export interface InquiryRow {
  id: string;
  createdAt: string;
  name: string;
  phone: string | null;
  email: string | null;
  message: string | null;
  source: string;
  status: string;
  /** The listing asked about, when the inquiry came from a property page. */
  property: { id: string; slug: string; title: string | null; listingStatus: string } | null;
}

/** Most recent inquiries shown on the page. */
export const INQUIRY_LIMIT = 200;

type Row = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? v : null);

export async function listInquiries(): Promise<AdminResult<InquiryRow[]>> {
  const db = supabaseAdmin();
  if (!db) return { ok: false, reason: "unconfigured" };

  const { data, error } = await db
    .from("inquiries")
    .select("id, created_at, name, phone, email, message, source, status, " +
      "property:properties(id, slug, title, listing_status)")
    .order("created_at", { ascending: false })
    .limit(INQUIRY_LIMIT);

  if (error) {
    console.error("[admin] inquiries failed", { code: error.code });
    return { ok: false, reason: "unavailable" };
  }

  return {
    ok: true,
    data: ((data ?? []) as unknown as Row[]).map((r) => {
      const p = (Array.isArray(r.property) ? r.property[0] : r.property) as Row | null | undefined;
      return {
        id: String(r.id),
        createdAt: String(r.created_at),
        name: String(r.name),
        phone: str(r.phone),
        email: str(r.email),
        message: str(r.message),
        source: String(r.source),
        status: String(r.status),
        property: p && str(p.id) && str(p.slug)
          ? { id: String(p.id), slug: String(p.slug), title: str(p.title), listingStatus: String(p.listing_status) }
          : null,
      };
    }),
  };
}
