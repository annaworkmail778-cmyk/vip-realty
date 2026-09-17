-- ---------------------------------------------------------------------------
-- VIP Realty — property viewing booking system
--
-- Business timezone is Asia/Yerevan (UTC+4, no DST). Viewing times are stored
-- as the wall-clock date + time the customer actually chose, and `starts_at`
-- is derived from them so queries and reminders have an unambiguous instant.
-- Nothing in this file touches pre-existing tables.
-- ---------------------------------------------------------------------------

create extension if not exists pgcrypto;

-- --------------------------------------------------------------- properties
create table if not exists public.properties (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique,
  title         text not null,
  location      text not null,
  address       text,
  property_type text not null default 'apartment',
  status        text not null default 'available'
                check (status in ('available', 'reserved', 'sold', 'let', 'withdrawn')),
  -- 'standard' takes slots from the schedule; 'appointment_only' collects a
  -- request without offering times; 'unavailable' hides booking entirely.
  viewing_mode  text not null default 'standard'
                check (viewing_mode in ('standard', 'appointment_only', 'unavailable')),
  viewing_duration_minutes int not null default 90 check (viewing_duration_minutes between 15 and 480),
  images        jsonb not null default '[]'::jsonb,
  price         numeric(12, 2),
  price_period  text check (price_period in ('month', 'year')),
  metadata      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ------------------------------------------------------- recurring schedule
-- The agency default is a row with property_id IS NULL. Any property that has
-- rules of its own uses those instead, which is how two listings can offer
-- different hours.
create table if not exists public.viewing_schedule_rules (
  id           uuid primary key default gen_random_uuid(),
  property_id  uuid references public.properties(id) on delete cascade,
  weekday      int not null check (weekday between 0 and 6),   -- 0 = Sunday
  start_time   time not null,
  end_time     time not null,
  slot_minutes int not null default 90 check (slot_minutes between 15 and 480),
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  check (end_time > start_time)
);

create index if not exists viewing_schedule_rules_lookup
  on public.viewing_schedule_rules (property_id, weekday) where is_active;

-- ------------------------------------------------- explicit per-date slots
-- Rows here override the recurring rules for that date completely: use them
-- to open a one-off Sunday, or to take a single slot out of a normal day.
create table if not exists public.viewing_availability (
  id           uuid primary key default gen_random_uuid(),
  property_id  uuid references public.properties(id) on delete cascade,
  date         date not null,
  start_time   time not null,
  end_time     time not null,
  is_available boolean not null default true,
  note         text,
  created_at   timestamptz not null default now(),
  check (end_time > start_time),
  unique (property_id, date, start_time)
);

create index if not exists viewing_availability_lookup
  on public.viewing_availability (property_id, date);

-- ------------------------------------------------------------- blackouts
-- Subtractive. A null start_time blocks the whole day; a null property_id
-- blocks it across every listing (public holidays, office closures).
create table if not exists public.viewing_blackouts (
  id          uuid primary key default gen_random_uuid(),
  property_id uuid references public.properties(id) on delete cascade,
  date        date not null,
  start_time  time,
  end_time    time,
  reason      text,
  created_at  timestamptz not null default now()
);

create index if not exists viewing_blackouts_lookup
  on public.viewing_blackouts (date, property_id);

-- --------------------------------------------------------------- bookings
create sequence if not exists public.viewing_booking_ref_seq;

create table if not exists public.viewing_bookings (
  id                  uuid primary key default gen_random_uuid(),
  booking_reference   text not null unique,
  property_id         uuid not null references public.properties(id) on delete restrict,

  customer_name       text not null check (length(btrim(customer_name)) between 2 and 120),
  customer_phone      text not null check (length(btrim(customer_phone)) between 5 and 40),
  customer_email      text not null check (customer_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  customer_message    text,
  contact_consent     boolean not null default false,

  viewing_date        date not null,
  viewing_start_time  time not null,
  viewing_end_time    time not null,
  -- Derived from the three columns above at Asia/Yerevan by a trigger, so a
  -- 15:00 booking is 15:00 for the customer and for the agent, always.
  starts_at           timestamptz,

  viewing_type        text not null default 'in_person'
                      check (viewing_type in ('in_person', 'virtual')),

  status              text not null default 'pending'
                      check (status in ('pending', 'confirmed', 'cancelled', 'completed', 'no_show')),
  confirmation_status text not null default 'pending'
                      check (confirmation_status in ('pending', 'confirmed', 'declined', 'expired')),

  -- Lets a guest manage their own booking from an emailed link without ever
  -- creating an account, and without exposing anyone else's booking.
  manage_token        uuid not null default gen_random_uuid(),

  source              text not null default 'website'
                      check (source in ('website', 'admin', 'phone', 'import')),
  cancelled_by        text check (cancelled_by in ('customer', 'admin', 'system')),
  cancelled_at        timestamptz,
  cancellation_reason text,
  reminder_sent_at    timestamptz,
  confirmed_at        timestamptz,
  rescheduled_from    uuid references public.viewing_bookings(id) on delete set null,
  agent_id            uuid,
  internal_note       text,
  metadata            jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check (viewing_end_time > viewing_start_time)
);

-- The hard guarantee against double booking. Two customers can hold the same
-- slot only if one of the bookings is cancelled/completed/no-show.
create unique index if not exists viewing_bookings_slot_unique
  on public.viewing_bookings (property_id, viewing_date, viewing_start_time)
  where status in ('pending', 'confirmed');

create index if not exists viewing_bookings_starts_at on public.viewing_bookings (starts_at);
create index if not exists viewing_bookings_date on public.viewing_bookings (viewing_date, property_id);
create index if not exists viewing_bookings_status on public.viewing_bookings (status, confirmation_status);
create index if not exists viewing_bookings_email on public.viewing_bookings (lower(customer_email));

-- ---------------------------------------------------- notification outbox
-- Events are written in the same transaction as the change that caused them,
-- then delivered by a worker. Telegram being down cannot lose a booking.
create table if not exists public.notification_events (
  id           uuid primary key default gen_random_uuid(),
  event        text not null check (event in (
                 'booking.created', 'booking.confirmed', 'booking.cancelled',
                 'booking.rescheduled', 'customer.confirmed', 'customer.declined',
                 'customer.not_confirmed', 'viewing.completed', 'viewing.no_show',
                 'reminder.customer')),
  channel      text not null default 'telegram'
               check (channel in ('telegram', 'email', 'sms', 'whatsapp')),
  booking_id   uuid references public.viewing_bookings(id) on delete cascade,
  payload      jsonb not null default '{}'::jsonb,
  status       text not null default 'queued'
               check (status in ('queued', 'sent', 'failed', 'skipped')),
  attempts     int not null default 0,
  last_error   text,
  scheduled_for timestamptz not null default now(),
  delivered_at timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists notification_events_pending
  on public.notification_events (status, scheduled_for) where status = 'queued';

-- ------------------------------------------------------------- settings
create table if not exists public.viewing_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

-- --------------------------------------------------------------- triggers
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.viewing_bookings_derive()
returns trigger language plpgsql as $$
begin
  -- One place converts Yerevan wall-clock into an instant.
  new.starts_at := (new.viewing_date + new.viewing_start_time) at time zone 'Asia/Yerevan';
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists viewing_bookings_derive_trg on public.viewing_bookings;
create trigger viewing_bookings_derive_trg
  before insert or update on public.viewing_bookings
  for each row execute function public.viewing_bookings_derive();

drop trigger if exists properties_touch_trg on public.properties;
create trigger properties_touch_trg
  before update on public.properties
  for each row execute function public.touch_updated_at();
