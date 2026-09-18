-- =============================================================================
-- Phase 6 — slug fix: drop thousands separators before slugifying
--   "2,000 m² land for sale in Abovyan" -> "2000-m2-land-for-sale-in-abovyan" (was "2-000-m2-...").
-- Rollback: re-create property_slug_base from 20260918082610_property_draft_generation.sql.
-- =============================================================================

create or replace function public.property_slug_base(p_title text)
returns text
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select coalesce(nullif(
           regexp_replace(
             left(btrim(regexp_replace(
                          regexp_replace(replace(lower(coalesce(p_title, '')), 'm²', 'm2'), '([0-9]),([0-9])', '\1\2', 'g'),
                          '[^a-z0-9]+', '-', 'g'), '-'), 80),
             '-+$', ''),
           ''), 'property');
$$;

comment on function public.property_slug_base(text) is
  'URL-safe slug base (a-z, 0-9, single hyphens, <= 80 chars) derived from the deterministic title; digit-group '
  'commas are removed first.';

revoke execute on function public.property_slug_base(text) from public, anon, authenticated;
grant execute on function public.property_slug_base(text) to service_role;
