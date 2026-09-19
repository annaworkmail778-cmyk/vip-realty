import { isAdminRequest } from "@/lib/admin/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/* ----------------------------------------------------------------------------
   Authenticated image access for admin review.

   The admin UI never depends on public Storage URLs of draft images: every
   thumbnail goes through this route, which checks the admin session, looks the
   object up by id in the database (never by a caller-supplied path), downloads
   it server-side with the service role, and returns it with no-store caching.

     /api/admin/images/property/<property_images.id>   gallery copy (property-images)
     /api/admin/images/media/<whatsapp_media.id>       validated WhatsApp original (private whatsapp-media)

   Only content whose type was detected and validated by the media pipeline is
   served, with a fixed image Content-Type, nosniff and a sandboxing CSP, so a
   rejected or disguised file can never be rendered as anything but an image.
---------------------------------------------------------------------------- */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EXT_TYPE: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", avif: "image/avif" };
const ALLOWED = new Set(Object.values(EXT_TYPE));
const PREVIEWABLE = new Set(["validated", "attaching", "uploaded", "attached"]);

const deny = (status: number) =>
  new Response(null, { status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });

export async function GET(req: Request, { params }: { params: Promise<{ kind: string; id: string }> }) {
  if (!isAdminRequest(req)) return deny(401);
  const { kind, id } = await params;
  if (!UUID.test(id) || (kind !== "property" && kind !== "media")) return deny(404);

  const db = supabaseAdmin();
  if (!db) return deny(503);

  let bucket: string;
  let path: string;
  let type: string | undefined;

  if (kind === "property") {
    const { data, error } = await db.from("property_images").select("storage_path").eq("id", id).maybeSingle();
    if (error) return deny(502);
    if (!data) return deny(404);
    bucket = "property-images";
    path = String(data.storage_path);
    type = EXT_TYPE[path.split(".").pop()?.toLowerCase() ?? ""];
  } else {
    const { data, error } = await db.from("whatsapp_media")
      .select("storage_path, download_status, detected_mime_type").eq("id", id).maybeSingle();
    if (error) return deny(502);
    if (!data || !data.storage_path || !PREVIEWABLE.has(String(data.download_status))) return deny(404);
    bucket = "whatsapp-media";
    path = String(data.storage_path);
    type = typeof data.detected_mime_type === "string" ? data.detected_mime_type : undefined;
  }
  if (!type || !ALLOWED.has(type)) return deny(404);

  const file = await db.storage.from(bucket).download(path);
  if (file.error || !file.data) return deny(404);

  return new Response(file.data.stream(), {
    headers: {
      "content-type": type,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
      "content-disposition": "inline",
      "referrer-policy": "no-referrer",
    },
  });
}
