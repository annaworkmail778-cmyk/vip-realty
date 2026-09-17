-- =============================================================================
-- Realty foundation 4/5 — public read model
--
-- The ONLY public (anon / authenticated) access in the new schema:
--   * SELECT on public columns of properties whose listing_status = 'published';
--   * SELECT on public columns of images whose property is published;
--   * the published_property_listings view (security_invoker, so the same RLS
--     and column privileges apply to whoever queries it).
--
-- Deliberately NOT public: address, latitude/longitude (address visibility not
-- decided), metadata, agent_id, review/source/session fields, legacy booking
-- columns, and every WhatsApp / extraction / inquiry / agent / event table.
-- Writes remain server-side only (service role in Next.js server code and n8n).
-- =============================================================================

-- ------------------------------------------------------------------ properties
grant select (
  id, agency_id, slug, title, description, listing_status, intent, property_type,
  country, city, district,
  price, currency, price_period, price_negotiable,
  area_sqm, land_area_sqm, rooms, bedrooms, bathrooms, floor, total_floors, year_built,
  features, featured, published_at, created_at, updated_at
) on table public.properties to anon, authenticated;

create policy properties_public_read_published
  on public.properties
  for select
  to anon, authenticated
  using (listing_status = 'published');

-- ------------------------------------------------------------- property_images
grant select (
  id, property_id, storage_path, sort_order, alt_text, is_primary, width, height
) on table public.property_images to anon, authenticated;

create policy property_images_public_read_published
  on public.property_images
  for select
  to anon, authenticated
  using (
    exists (
      select 1
      from public.properties p
      where p.id = property_images.property_id
        and p.listing_status = 'published'
    )
  );

-- -------------------------------------------------- published listings read view
create view public.published_property_listings
with (security_invoker = true)
as
select
  p.id,
  p.agency_id,
  p.slug,
  p.title,
  p.description,
  p.intent,
  p.property_type,
  p.country,
  p.city,
  p.district,
  p.price,
  p.currency,
  p.price_period,
  p.price_negotiable,
  p.area_sqm,
  p.land_area_sqm,
  p.rooms,
  p.bedrooms,
  p.bathrooms,
  p.floor,
  p.total_floors,
  p.year_built,
  p.features,
  p.featured,
  p.published_at,
  p.updated_at,
  cover.storage_path as primary_image_path,
  coalesce(gallery.images, '[]'::jsonb) as images
from public.properties p
left join lateral (
  select i.storage_path
  from public.property_images i
  where i.property_id = p.id
  order by i.is_primary desc, i.sort_order
  limit 1
) cover on true
left join lateral (
  select jsonb_agg(
           jsonb_build_object(
             'id', i.id,
             'storage_path', i.storage_path,
             'sort_order', i.sort_order,
             'alt_text', i.alt_text,
             'is_primary', i.is_primary,
             'width', i.width,
             'height', i.height
           )
           order by i.sort_order
         ) as images
  from public.property_images i
  where i.property_id = p.id
) gallery on true
where p.listing_status = 'published';

comment on view public.published_property_listings is
  'Public read model: published properties with their ordered images (storage paths in the property-images bucket). security_invoker: RLS and column grants of the caller apply.';

revoke all on table public.published_property_listings from anon, authenticated;
grant select on table public.published_property_listings to anon, authenticated;
