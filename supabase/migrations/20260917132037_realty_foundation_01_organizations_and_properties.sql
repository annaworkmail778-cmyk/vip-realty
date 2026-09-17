-- =============================================================================
-- Realty foundation 1/5 — agencies, agents and the database-driven property model
--
-- Non-destructive. public.properties already exists (legacy booking copy of the
-- hard-coded listings, 6 rows). It is extended in place:
--   * new nullable columns for the real listing model (unknown = NULL);
--   * a NEW lifecycle column `listing_status`, separate from the legacy booking
--     column `status` (available/reserved/sold/let/withdrawn), which is untouched;
--   * NOT NULL relaxed on title/location/property_type so incomplete WhatsApp
--     drafts can exist, and the fake 'apartment' default removed;
--   * price_period widened to also allow 'day'.
-- No existing row value is changed. Booking functions only read properties.id,
-- viewing_mode and viewing_duration_minutes, which are unchanged.
--
-- This project grants anon/authenticated full privileges on new tables by
-- default, so every table created here has RLS enabled and those grants revoked
-- in this same migration.
-- =============================================================================

-- ------------------------------------------------------------------ agencies
create table public.agencies (
  id                       uuid primary key default gen_random_uuid(),
  name                     text not null,
  slug                     text not null,
  whatsapp_phone_number_id text,
  settings                 jsonb not null default '{}'::jsonb,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint agencies_slug_key unique (slug),
  constraint agencies_whatsapp_phone_number_id_key unique (whatsapp_phone_number_id),
  constraint agencies_name_check check (btrim(name) <> '' and char_length(name) <= 160),
  constraint agencies_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 60),
  constraint agencies_whatsapp_phone_number_id_format check (whatsapp_phone_number_id ~ '^[0-9]{5,30}$'),
  constraint agencies_settings_object check (jsonb_typeof(settings) = 'object')
);

comment on table public.agencies is
  'Real-estate agency (tenant). V1 has one agency; agency_id exists so the system can be reused.';
comment on column public.agencies.whatsapp_phone_number_id is
  'Meta WhatsApp Cloud API phone_number_id of the agency business number; routes inbound webhooks to the agency.';

create trigger agencies_touch_trg before update on public.agencies
  for each row execute function public.touch_updated_at();

alter table public.agencies enable row level security;
revoke all on table public.agencies from anon, authenticated;

-- -------------------------------------------------------------------- agents
create table public.agents (
  id             uuid primary key default gen_random_uuid(),
  agency_id      uuid not null references public.agencies (id) on delete restrict,
  name           text not null,
  phone          text,
  whatsapp_phone text,
  email          text,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint agents_agency_whatsapp_phone_key unique (agency_id, whatsapp_phone),
  constraint agents_name_check check (btrim(name) <> '' and char_length(name) <= 160),
  constraint agents_phone_e164 check (phone ~ '^\+[1-9][0-9]{6,14}$'),
  constraint agents_whatsapp_phone_e164 check (whatsapp_phone ~ '^\+[1-9][0-9]{6,14}$'),
  constraint agents_email_format check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(email) <= 254)
);

comment on table public.agents is
  'Agency staff allowed to submit listings. whatsapp_phone (E.164) resolves an inbound WhatsApp sender to an agent.';

create unique index agents_agency_email_key on public.agents (agency_id, lower(email)) where email is not null;
create index agents_whatsapp_phone_idx on public.agents (whatsapp_phone) where whatsapp_phone is not null;

create trigger agents_touch_trg before update on public.agents
  for each row execute function public.touch_updated_at();

alter table public.agents enable row level security;
revoke all on table public.agents from anon, authenticated;

-- ------------------------------------------------ properties: relax legacy NOT NULLs
alter table public.properties
  alter column title drop not null,
  alter column location drop not null,
  alter column property_type drop not null,
  alter column property_type drop default;

-- ---------------------------------------------------- properties: new columns
alter table public.properties
  add column agency_id                 uuid references public.agencies (id) on delete restrict,
  add column agent_id                  uuid references public.agents (id) on delete set null,
  add column listing_status            text not null default 'draft',
  add column review_status             text,
  add column listing_status_changed_at timestamptz not null default now(),
  add column published_at              timestamptz,
  add column intent                    text,
  add column description               text,
  add column country                   text,
  add column city                      text,
  add column district                  text,
  add column latitude                  numeric(9, 6),
  add column longitude                 numeric(9, 6),
  add column currency                  text,
  add column price_negotiable          boolean,
  add column area_sqm                  numeric(10, 2),
  add column land_area_sqm             numeric(12, 2),
  add column rooms                     smallint,
  add column bedrooms                  smallint,
  add column bathrooms                 smallint,
  add column floor                     smallint,
  add column total_floors              smallint,
  add column year_built                smallint,
  add column features                  text[] not null default '{}'::text[],
  add column featured                  boolean not null default false,
  add column source                    text;

-- ------------------------------------------------------ properties: constraints
alter table public.properties drop constraint properties_price_period_check;

alter table public.properties
  add constraint properties_price_period_check
    check (price_period in ('month', 'day', 'year')),
  add constraint properties_listing_status_check
    check (listing_status in ('draft', 'published', 'sold', 'rented', 'archived')),
  add constraint properties_review_status_check
    check (review_status in ('pending', 'approved', 'rejected')),
  add constraint properties_intent_check
    check (intent in ('buy', 'rent')),
  add constraint properties_property_type_check
    check (property_type in ('apartment', 'penthouse', 'house', 'villa', 'townhouse', 'commercial',
                             'office', 'retail', 'warehouse', 'land', 'garage', 'other')),
  add constraint properties_source_check
    check (source in ('whatsapp', 'admin', 'import', 'seed')),
  add constraint properties_currency_check
    check (currency in ('USD', 'AMD', 'EUR', 'RUB')),
  add constraint properties_country_check
    check (country ~ '^[A-Z]{2}$'),
  add constraint properties_text_not_blank check (
    (title is null or btrim(title) <> '')
    and (description is null or btrim(description) <> '')
    and (city is null or btrim(city) <> '')
    and (district is null or btrim(district) <> '')
    and (address is null or btrim(address) <> '')
  ),
  add constraint properties_price_positive check (price > 0),
  add constraint properties_sale_has_no_price_period
    check (intent is distinct from 'buy' or price_period is null),
  add constraint properties_coordinates_check check (
    (latitude is null) = (longitude is null)
    and latitude between -90 and 90
    and longitude between -180 and 180
  ),
  add constraint properties_area_sqm_check check (area_sqm > 0 and area_sqm < 100000),
  add constraint properties_land_area_sqm_check check (land_area_sqm > 0),
  add constraint properties_rooms_check check (rooms between 0 and 50),
  add constraint properties_bedrooms_check check (bedrooms between 0 and 50),
  add constraint properties_bathrooms_check check (bathrooms between 0 and 20),
  add constraint properties_floor_check check (floor between -5 and 200),
  add constraint properties_total_floors_check check (total_floors between 1 and 200),
  add constraint properties_floor_within_building check (floor is null or total_floors is null or floor <= total_floors),
  add constraint properties_year_built_check check (year_built between 1800 and 2100),
  add constraint properties_features_format check (
    cardinality(features) = 0
    or array_to_string(features, ',', '<null>') ~ '^[a-z0-9_]+(,[a-z0-9_]+)*$'
  ),
  add constraint properties_agency_required
    check (listing_status in ('draft', 'archived') or agency_id is not null),
  add constraint properties_sold_is_sale
    check (listing_status <> 'sold' or intent = 'buy'),
  add constraint properties_rented_is_rent
    check (listing_status <> 'rented' or intent = 'rent'),
  add constraint properties_publishable check (
    listing_status <> 'published' or (
      review_status = 'approved'
      and title is not null
      and intent is not null
      and property_type is not null
      and city is not null
      and price is not null
      and currency is not null
    )
  );

-- --------------------------------------------------------- properties: comments
comment on column public.properties.listing_status is
  'Public listing lifecycle: draft, published, sold, rented, archived. Only published rows are publicly readable.';
comment on column public.properties.review_status is
  'Human review state. A listing can only be published when review_status = approved.';
comment on column public.properties.intent is 'Transaction intent: buy (for sale) or rent.';
comment on column public.properties.price_period is
  'NULL for a one-off sale price (or unknown); month / day / year for rentals.';
comment on column public.properties.price_negotiable is 'TRUE when the agent states the price is negotiable. NULL = unknown.';
comment on column public.properties.features is 'Normalized feature codes (lowercase snake_case), e.g. {balcony,parking}.';
comment on column public.properties.metadata is 'Extra attributes that do not warrant a column. Not publicly readable.';
comment on column public.properties.address is 'Exact address when known. Not publicly readable until address visibility is decided.';
comment on column public.properties.status is
  'LEGACY booking status (available/reserved/sold/let/withdrawn). Not used by the new listing model; removed with booking.';
comment on column public.properties.location is 'LEGACY display string from the hard-coded listings. Superseded by country/city/district.';
comment on column public.properties.viewing_mode is 'LEGACY booking setting. Removed with booking.';
comment on column public.properties.viewing_duration_minutes is 'LEGACY booking setting. Removed with booking.';
comment on column public.properties.images is 'LEGACY, unused. Superseded by public.property_images.';

-- ------------------------------------------------------------ properties: indexes
create index properties_agency_listing_idx
  on public.properties (agency_id, listing_status, created_at desc);
create index properties_agent_idx
  on public.properties (agent_id) where agent_id is not null;
create index properties_published_filter_idx
  on public.properties (intent, property_type, city, district) where listing_status = 'published';
create index properties_published_price_idx
  on public.properties (price) where listing_status = 'published';
create index properties_published_bedrooms_idx
  on public.properties (bedrooms) where listing_status = 'published';
create index properties_published_area_idx
  on public.properties (area_sqm) where listing_status = 'published';
create index properties_published_recent_idx
  on public.properties (featured desc, published_at desc) where listing_status = 'published';

-- ------------------------------------------------ properties: lifecycle enforcement
create function public.properties_listing_lifecycle()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    new.listing_status_changed_at := now();
    if new.listing_status = 'published' then
      new.published_at := coalesce(new.published_at, now());
    end if;
    return new;
  end if;

  if new.listing_status is distinct from old.listing_status then
    if not (
         (old.listing_status = 'draft'     and new.listing_status in ('published', 'archived'))
      or (old.listing_status = 'published' and new.listing_status in ('draft', 'sold', 'rented', 'archived'))
      or (old.listing_status = 'sold'      and new.listing_status in ('published', 'archived'))
      or (old.listing_status = 'rented'    and new.listing_status in ('published', 'archived'))
      or (old.listing_status = 'archived'  and new.listing_status = 'draft')
    ) then
      raise exception 'invalid listing_status transition: % -> %', old.listing_status, new.listing_status
        using errcode = 'check_violation';
    end if;

    new.listing_status_changed_at := now();
    if new.listing_status = 'published' then
      new.published_at := now();
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function public.properties_listing_lifecycle() from public, anon, authenticated;

create trigger properties_listing_lifecycle_trg
  before insert or update of listing_status on public.properties
  for each row execute function public.properties_listing_lifecycle();
