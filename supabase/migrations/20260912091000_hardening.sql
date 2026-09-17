-- ---------------------------------------------------------------------------
-- Hardening, from the Supabase security advisor.
-- ---------------------------------------------------------------------------

-- `unique (property_id, date, start_time)` does not constrain rows where
-- property_id is null, because NULLs never conflict. Agency-wide one-off slots
-- could therefore be inserted twice and appear twice in the calendar.
create unique index if not exists viewing_availability_agency_unique
  on public.viewing_availability (date, start_time)
  where property_id is null;

-- A function without a pinned search_path resolves unqualified names against
-- whatever the caller's search_path happens to be. For trigger functions that
-- run as the table owner, that is a privilege-escalation vector.
alter function public.touch_updated_at() set search_path = public, pg_temp;
alter function public.viewing_bookings_derive() set search_path = public, pg_temp;
alter function public.yerevan_now() set search_path = public, pg_temp;
alter function public.viewing_setting(text, jsonb) set search_path = public, pg_temp;

-- Note on the advisor's "RLS enabled, no policy" notices for these tables:
-- that is the intended posture. anon and authenticated are granted nothing and
-- have no policies, so they can read and write nothing. All access is through
-- Next.js server code holding the service-role key, which bypasses RLS. See
-- 20260912090200_viewing_rls_and_defaults.sql.
