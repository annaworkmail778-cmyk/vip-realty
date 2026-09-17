-- =============================================================================
-- Realty foundation 5/5 — Storage buckets
--
--   property-images  PUBLIC. Website gallery images only, at
--                    properties/{property_id}/{uuid}.{ext}. Objects are served by
--                    the public object URL; there is NO storage.objects policy, so
--                    anon/authenticated cannot list, upload, update or delete.
--   whatsapp-media   PRIVATE. Originals downloaded from WhatsApp immediately on
--                    receipt, at {agency_id}/{yyyy}/{mm}/{whatsapp_media.id}.{ext}.
--                    Readable only server-side (service role / signed URLs).
--
-- Only server-side code holding the service-role key (n8n, Next.js server)
-- writes to either bucket. Temporary WhatsApp media URLs are never stored.
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('property-images', 'property-images', true, 10485760,
     array['image/jpeg', 'image/png', 'image/webp', 'image/avif']),
  ('whatsapp-media', 'whatsapp-media', false, 26214400, null)
on conflict (id) do nothing;
