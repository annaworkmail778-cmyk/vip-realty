-- =============================================================================
-- Remove the obsolete property viewing / booking system.
--
-- Property viewing and booking are no longer part of the product (Phase 3).
-- Dependency verification performed before this migration (see
-- docs/rebuild/phase-03-booking-removal.md):
--   * no application code references these objects any more;
--   * no views, policies or non-booking functions reference them;
--   * no triggers on non-booking tables call booking functions;
--   * no Edge Functions are deployed and pg_cron / pg_net are not installed;
--   * the wedding RSVP app only uses public.rsvps;
--   * viewing_bookings, viewing_availability and viewing_blackouts are empty.
--
-- Data removed: the booking system's own default configuration only —
-- 6 agency-wide schedule rules (Mon–Fri 10:00–19:00, Sat 11:00–16:00, 90-minute
-- slots) and 1 settings row ("booking": timezone, lead time, reminders). No
-- customer data exists.
--
-- NOT removed (still required or deliberately retained):
--   * public.touch_updated_at()  — used by 8 non-booking tables' triggers;
--   * public.properties and its legacy columns (status, location, viewing_mode,
--     viewing_duration_minutes, images) — retained so the six legacy listing
--     rows stay byte-for-byte intact; application code no longer reads them.
--
-- No CASCADE is used: if anything unexpected depends on these objects, the
-- migration fails instead of silently removing more.
-- =============================================================================

do $$
begin
  if exists (select 1 from public.viewing_bookings) then
    raise exception 'viewing_bookings is not empty; refusing to remove the booking system';
  end if;
  if exists (select 1 from public.viewing_availability) or exists (select 1 from public.viewing_blackouts) then
    raise exception 'viewing availability data exists; refusing to remove the booking system';
  end if;
  -- Phase 11: the original shared-project sanity check (public.rsvps must exist) is removed so this history also
  -- replays on the dedicated realty project, which by design has no RSVP tables.
  if to_regclass('public.notification_events') is not null
     and exists (select 1 from public.notification_events) then
    raise exception 'notification_events is not empty; refusing to remove the booking system';
  end if;
  if exists (
    select 1
    from pg_depend d
    join pg_rewrite r on r.oid = d.objid
    where d.refobjid in (
      'public.viewing_bookings'::regclass, 'public.viewing_availability'::regclass,
      'public.viewing_blackouts'::regclass, 'public.viewing_schedule_rules'::regclass,
      'public.viewing_settings'::regclass
    )
      and r.ev_class not in (
      'public.viewing_bookings'::regclass, 'public.viewing_availability'::regclass,
      'public.viewing_blackouts'::regclass, 'public.viewing_schedule_rules'::regclass,
      'public.viewing_settings'::regclass
    )
  ) then
    raise exception 'a view depends on a booking table; aborting';
  end if;
end $$;

-- Booking RPCs (reference the tables below).
drop function public.create_viewing_booking(text, date, time without time zone, text, text, text, text, boolean, text, text);
drop function public.cancel_viewing_booking(text, uuid, text, text);
drop function public.confirm_viewing_booking(text, uuid);
drop function public.reschedule_viewing_booking(text, date, time without time zone, text);
drop function public.queue_viewing_reminders(integer);
drop function public.expire_viewing_confirmations();
drop function public.viewing_open_slots(uuid, date, date);
drop function public.viewing_slots_for_date(uuid, date);

-- Booking notification outbox (created by the viewing schema; FK to viewing_bookings). In the original shared project
-- it had already been dropped outside the migration history before this ran; Phase 11 adds the drop here so a fresh
-- database converges to the same end state. `if exists` keeps it a no-op where it is already gone.
drop table if exists public.notification_events;

-- Booking tables (their indexes, constraints, trigger and FKs to properties go with them).
drop table public.viewing_bookings;
drop table public.viewing_availability;
drop table public.viewing_blackouts;
drop table public.viewing_schedule_rules;
drop table public.viewing_settings;

-- Booking helpers now without users.
drop function public.viewing_bookings_derive();
drop function public.viewing_setting(text, jsonb);
drop function public.yerevan_now();
drop sequence public.viewing_booking_ref_seq;

-- Legacy columns retained on properties: document their status.
comment on column public.properties.status is
  'LEGACY, unused. Former booking availability status. Booking removed; not read by the application. Candidate for removal.';
comment on column public.properties.location is
  'LEGACY, unused. Display string from the former hard-coded listings; superseded by country/city/district. Candidate for removal.';
comment on column public.properties.viewing_mode is
  'LEGACY, unused. Former booking setting. Booking removed; not read by the application. Candidate for removal.';
comment on column public.properties.viewing_duration_minutes is
  'LEGACY, unused. Former booking setting. Booking removed; not read by the application. Candidate for removal.';
comment on column public.properties.images is
  'LEGACY, unused. Superseded by public.property_images. Candidate for removal.';
