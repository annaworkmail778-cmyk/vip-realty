-- ---------------------------------------------------------------------------
-- Row-level security, grants and seed defaults.
--
-- Posture: the browser never talks to these tables. RLS is enabled with no
-- policies for anon/authenticated, so those roles see nothing, and every read
-- and write goes through Next.js server code holding the service-role key.
-- A leaked publishable key therefore exposes no customer data.
-- ---------------------------------------------------------------------------

-- Slot resolution reads viewing_bookings. Without security definer, a caller
-- whose RLS hides bookings would be told taken slots are free.
alter function public.viewing_slots_for_date(uuid, date) security definer set search_path = public;
alter function public.viewing_open_slots(uuid, date, date) security definer set search_path = public;

alter table public.properties             enable row level security;
alter table public.viewing_schedule_rules enable row level security;
alter table public.viewing_availability   enable row level security;
alter table public.viewing_blackouts      enable row level security;
alter table public.viewing_bookings       enable row level security;
alter table public.notification_events    enable row level security;
alter table public.viewing_settings       enable row level security;

revoke all on public.properties, public.viewing_schedule_rules,
  public.viewing_availability, public.viewing_blackouts, public.viewing_bookings,
  public.notification_events, public.viewing_settings
  from anon, authenticated;

revoke all on sequence public.viewing_booking_ref_seq from anon, authenticated;

revoke execute on function
  public.create_viewing_booking(text, date, time, text, text, text, text, boolean, text, text),
  public.cancel_viewing_booking(text, uuid, text, text),
  public.confirm_viewing_booking(text, uuid),
  public.reschedule_viewing_booking(text, date, time, text),
  public.queue_viewing_reminders(int),
  public.expire_viewing_confirmations(),
  public.viewing_slots_for_date(uuid, date),
  public.viewing_open_slots(uuid, date, date),
  public.viewing_setting(text, jsonb)
  from public, anon, authenticated;

grant execute on function
  public.create_viewing_booking(text, date, time, text, text, text, text, boolean, text, text),
  public.cancel_viewing_booking(text, uuid, text, text),
  public.confirm_viewing_booking(text, uuid),
  public.reschedule_viewing_booking(text, date, time, text),
  public.queue_viewing_reminders(int),
  public.expire_viewing_confirmations(),
  public.viewing_slots_for_date(uuid, date),
  public.viewing_open_slots(uuid, date, date),
  public.viewing_setting(text, jsonb)
  to service_role;

-- ------------------------------------------------------------- defaults
insert into public.viewing_settings (key, value) values
  ('booking', jsonb_build_object(
    'timezone', 'Asia/Yerevan',
    'min_lead_minutes', 180,
    'max_days_ahead', 60,
    'default_slot_minutes', 90,
    'auto_cancel_unconfirmed', false,
    'reminder_hours_before', 24
  ))
on conflict (key) do nothing;

-- Agency-wide opening hours: any property without rules of its own uses these.
-- 10:00–19:00 in 90-minute slots gives 10:00, 11:30, 13:00, 14:30, 16:00, 17:30.
insert into public.viewing_schedule_rules (property_id, weekday, start_time, end_time, slot_minutes)
select null, wd, '10:00', '19:00', 90 from generate_series(1, 5) wd
where not exists (select 1 from public.viewing_schedule_rules where property_id is null);

insert into public.viewing_schedule_rules (property_id, weekday, start_time, end_time, slot_minutes)
select null, 6, '11:00', '16:00', 90
where not exists (select 1 from public.viewing_schedule_rules where property_id is null and weekday = 6);
