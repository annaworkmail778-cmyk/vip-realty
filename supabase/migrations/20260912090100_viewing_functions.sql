-- ---------------------------------------------------------------------------
-- Slot resolution and atomic booking.
--
-- Availability is resolved here rather than in the application so that the
-- times a customer is offered and the times the database will accept can
-- never drift apart. The booking path takes a transaction-scoped advisory
-- lock on the slot and relies on `viewing_bookings_slot_unique` as backstop,
-- so two customers racing for the same slot cannot both succeed.
-- ---------------------------------------------------------------------------

create or replace function public.viewing_setting(p_key text, p_default jsonb)
returns jsonb language sql stable as $$
  select coalesce((select value from public.viewing_settings where key = p_key), p_default);
$$;

create or replace function public.yerevan_now()
returns timestamp language sql stable as $$
  select (now() at time zone 'Asia/Yerevan');
$$;

-- Every slot for a date, with why each one is closed. The admin availability
-- screen shows closed slots too, which is why `reason` exists.
create or replace function public.viewing_slots_for_date(p_property uuid, p_date date)
returns table (start_time time, end_time time, is_open boolean, reason text)
language plpgsql stable as $$
declare
  v_mode text;
  v_duration int;
  v_has_explicit boolean;
  v_has_own_rules boolean;
  v_lead_minutes int;
  v_max_days int;
  v_now timestamp := public.yerevan_now();
begin
  select viewing_mode, viewing_duration_minutes into v_mode, v_duration
  from public.properties where id = p_property;

  if v_mode is null or v_mode <> 'standard' then
    return;
  end if;

  v_lead_minutes := coalesce((public.viewing_setting('booking', '{}'::jsonb) ->> 'min_lead_minutes')::int, 180);
  v_max_days     := coalesce((public.viewing_setting('booking', '{}'::jsonb) ->> 'max_days_ahead')::int, 60);

  if p_date > (v_now::date + v_max_days) then
    return;
  end if;

  select exists (select 1 from public.viewing_availability a
                 where a.property_id = p_property and a.date = p_date)
    into v_has_explicit;

  select exists (select 1 from public.viewing_schedule_rules r
                 where r.property_id = p_property and r.is_active)
    into v_has_own_rules;

  return query
  with base as (
    -- An explicit per-date entry replaces the recurring schedule for that day.
    select a.start_time, a.end_time, a.is_available
    from public.viewing_availability a
    where v_has_explicit and a.property_id = p_property and a.date = p_date

    union all

    select
      (gs)::time as start_time,
      (gs + make_interval(mins => r.slot_minutes))::time as end_time,
      true as is_available
    from public.viewing_schedule_rules r
    cross join lateral generate_series(
      p_date + r.start_time,
      p_date + r.end_time - make_interval(mins => r.slot_minutes),
      make_interval(mins => r.slot_minutes)
    ) as gs
    where not v_has_explicit
      and r.is_active
      and r.weekday = extract(dow from p_date)::int
      and (case when v_has_own_rules then r.property_id = p_property
                else r.property_id is null end)
  ),
  marked as (
    select
      b.start_time,
      b.end_time,
      case
        when not b.is_available then 'blocked'
        when (p_date + b.start_time) < (v_now + make_interval(mins => v_lead_minutes)) then 'past'
        when exists (
          select 1 from public.viewing_blackouts x
          where x.date = p_date
            and (x.property_id = p_property or x.property_id is null)
            and (x.start_time is null
                 or (b.start_time < coalesce(x.end_time, time '23:59:59')
                     and b.end_time > x.start_time))
        ) then 'blocked'
        when exists (
          select 1 from public.viewing_bookings bk
          where bk.property_id = p_property
            and bk.viewing_date = p_date
            and bk.viewing_start_time = b.start_time
            and bk.status in ('pending', 'confirmed')
        ) then 'booked'
        else null
      end as reason
    from base b
  )
  select m.start_time, m.end_time, m.reason is null, m.reason
  from marked m
  order by m.start_time;
end;
$$;

-- Open slots across a range, for the customer-facing calendar.
create or replace function public.viewing_open_slots(p_property uuid, p_from date, p_to date)
returns table (slot_date date, start_time time, end_time time)
language sql stable as $$
  select d::date, s.start_time, s.end_time
  from generate_series(p_from, p_to, interval '1 day') d
  cross join lateral public.viewing_slots_for_date(p_property, d::date) s
  where s.is_open
  order by d, s.start_time;
$$;

-- --------------------------------------------------------------- booking
create or replace function public.create_viewing_booking(
  p_property_slug text,
  p_date date,
  p_start_time time,
  p_name text,
  p_phone text,
  p_email text,
  p_message text default null,
  p_consent boolean default false,
  p_viewing_type text default 'in_person',
  p_source text default 'website'
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_property public.properties%rowtype;
  v_slot record;
  v_ref text;
  v_row public.viewing_bookings%rowtype;
begin
  select * into v_property from public.properties where slug = p_property_slug;
  if v_property.id is null then
    return jsonb_build_object('ok', false, 'error', 'property_not_found');
  end if;
  if v_property.viewing_mode <> 'standard' then
    return jsonb_build_object('ok', false, 'error', 'viewings_not_bookable');
  end if;

  -- Serialise everyone competing for this exact slot.
  perform pg_advisory_xact_lock(
    hashtextextended(v_property.id::text || p_date::text || p_start_time::text, 0)
  );

  select * into v_slot
  from public.viewing_slots_for_date(v_property.id, p_date) s
  where s.start_time = p_start_time;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'slot_not_offered');
  end if;
  if not v_slot.is_open then
    return jsonb_build_object('ok', false, 'error',
      case v_slot.reason when 'booked' then 'slot_taken' else 'slot_unavailable' end);
  end if;

  v_ref := 'VIP-'
    || to_char(public.yerevan_now(), 'YYYY') || '-'
    || lpad(nextval('public.viewing_booking_ref_seq')::text, 5, '0');

  begin
    insert into public.viewing_bookings (
      booking_reference, property_id, customer_name, customer_phone, customer_email,
      customer_message, contact_consent, viewing_date, viewing_start_time,
      viewing_end_time, viewing_type, source
    ) values (
      v_ref, v_property.id, btrim(p_name), btrim(p_phone), lower(btrim(p_email)),
      nullif(btrim(coalesce(p_message, '')), ''), p_consent, p_date, p_start_time,
      v_slot.end_time, p_viewing_type, p_source
    ) returning * into v_row;
  exception when unique_violation then
    -- Lost the race to a booking committed moments earlier.
    return jsonb_build_object('ok', false, 'error', 'slot_taken');
  end;

  insert into public.notification_events (event, booking_id, payload)
  values ('booking.created', v_row.id, jsonb_build_object('reference', v_row.booking_reference));

  return jsonb_build_object('ok', true, 'booking', to_jsonb(v_row));
end;
$$;

-- ------------------------------------------------- customer self-service
-- Both take the manage token, so a reference alone reveals nothing.
create or replace function public.cancel_viewing_booking(
  p_reference text, p_token uuid, p_by text default 'customer', p_reason text default null
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_row public.viewing_bookings%rowtype;
begin
  select * into v_row from public.viewing_bookings
  where booking_reference = p_reference and (p_by = 'admin' or manage_token = p_token)
  for update;

  if v_row.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if v_row.status = 'cancelled' then
    return jsonb_build_object('ok', true, 'booking', to_jsonb(v_row), 'already', true);
  end if;
  if v_row.status in ('completed', 'no_show') then
    return jsonb_build_object('ok', false, 'error', 'not_cancellable');
  end if;

  -- Leaving 'pending'/'confirmed' releases the slot: the partial unique index
  -- stops applying and `viewing_slots_for_date` stops counting it.
  update public.viewing_bookings
  set status = 'cancelled',
      confirmation_status = case when p_by = 'customer' then 'declined' else confirmation_status end,
      cancelled_by = p_by,
      cancelled_at = now(),
      cancellation_reason = p_reason
  where id = v_row.id
  returning * into v_row;

  insert into public.notification_events (event, booking_id, payload)
  values ('booking.cancelled', v_row.id,
          jsonb_build_object('reference', v_row.booking_reference, 'by', p_by));

  return jsonb_build_object('ok', true, 'booking', to_jsonb(v_row));
end;
$$;

create or replace function public.confirm_viewing_booking(p_reference text, p_token uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_row public.viewing_bookings%rowtype;
begin
  select * into v_row from public.viewing_bookings
  where booking_reference = p_reference and manage_token = p_token
  for update;

  if v_row.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if v_row.status = 'cancelled' then
    return jsonb_build_object('ok', false, 'error', 'cancelled');
  end if;

  update public.viewing_bookings
  set confirmation_status = 'confirmed',
      status = case when status = 'pending' then 'confirmed' else status end,
      confirmed_at = now()
  where id = v_row.id
  returning * into v_row;

  insert into public.notification_events (event, booking_id, payload)
  values ('customer.confirmed', v_row.id,
          jsonb_build_object('reference', v_row.booking_reference));

  return jsonb_build_object('ok', true, 'booking', to_jsonb(v_row));
end;
$$;

-- ------------------------------------------------------------ reschedule
-- The old slot is released and the new one taken inside one transaction, so
-- the booking is never briefly absent from both.
create or replace function public.reschedule_viewing_booking(
  p_reference text, p_date date, p_start_time time, p_by text default 'admin'
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_row public.viewing_bookings%rowtype;
  v_slot record;
  v_old jsonb;
begin
  select * into v_row from public.viewing_bookings
  where booking_reference = p_reference for update;

  if v_row.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if v_row.status in ('cancelled', 'completed', 'no_show') then
    return jsonb_build_object('ok', false, 'error', 'not_reschedulable');
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(v_row.property_id::text || p_date::text || p_start_time::text, 0)
  );

  select * into v_slot
  from public.viewing_slots_for_date(v_row.property_id, p_date) s
  where s.start_time = p_start_time;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'slot_not_offered');
  end if;
  -- The booking's current slot reads as 'booked' by itself; that is fine.
  if not v_slot.is_open
     and not (v_row.viewing_date = p_date and v_row.viewing_start_time = p_start_time) then
    return jsonb_build_object('ok', false, 'error',
      case v_slot.reason when 'booked' then 'slot_taken' else 'slot_unavailable' end);
  end if;

  v_old := jsonb_build_object('date', v_row.viewing_date, 'start_time', v_row.viewing_start_time);

  begin
    update public.viewing_bookings
    set viewing_date = p_date,
        viewing_start_time = p_start_time,
        viewing_end_time = v_slot.end_time,
        confirmation_status = 'pending',
        reminder_sent_at = null
    where id = v_row.id
    returning * into v_row;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'slot_taken');
  end;

  insert into public.notification_events (event, booking_id, payload)
  values ('booking.rescheduled', v_row.id,
          jsonb_build_object('reference', v_row.booking_reference, 'from', v_old, 'by', p_by));

  return jsonb_build_object('ok', true, 'booking', to_jsonb(v_row));
end;
$$;

-- ------------------------------------------------------------- reminders
-- Queues the 24-hour reminder for anything starting in the next 24 hours that
-- has not had one. Safe to call repeatedly; `reminder_sent_at` makes it
-- idempotent, so a cron double-fire cannot double-message a customer.
create or replace function public.queue_viewing_reminders(p_window_hours int default 24)
returns int
language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  with due as (
    select id from public.viewing_bookings
    where status in ('pending', 'confirmed')
      and reminder_sent_at is null
      and starts_at between now() and now() + make_interval(hours => p_window_hours)
  ), queued as (
    insert into public.notification_events (event, channel, booking_id, payload)
    select 'reminder.customer', 'email', d.id, '{}'::jsonb from due d
    returning booking_id
  )
  update public.viewing_bookings b
  set reminder_sent_at = now()
  from queued q where b.id = q.booking_id;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Marks bookings whose viewing has passed without the customer responding.
-- It never cancels: an unconfirmed viewing is still a viewing until an admin
-- decides otherwise.
create or replace function public.expire_viewing_confirmations()
returns int
language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  with expired as (
    update public.viewing_bookings
    set confirmation_status = 'expired'
    where confirmation_status = 'pending'
      and status in ('pending', 'confirmed')
      and starts_at < now()
    returning id
  )
  insert into public.notification_events (event, booking_id, payload)
  select 'customer.not_confirmed', id, '{}'::jsonb from expired;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
