-- =============================================================================
-- Website "Request more information" submission.
--
-- public.inquiries stays private: anon/authenticated have no table privileges
-- and no RLS policies. The only public write path is this function, called by
-- the Next.js server route /api/inquiries with the publishable key:
--
--   * re-validates every field (the route validates too);
--   * accepts a listing SLUG, never a property id, and resolves it only if the
--     listing is currently published — drafts, sold, rented and archived
--     listings cannot receive inquiries;
--   * derives agency_id from the listing (never from the caller);
--   * is idempotent per form submission (client_submission_id), so a double
--     click or retry creates one inquiry, while later inquiries stay possible;
--   * applies a small flood guard (same phone + listing, 10 minutes);
--   * returns only a status code — never ids, rows or database errors.
--
-- SECURITY DEFINER is required because the caller has no table privileges;
-- search_path is pinned and the function performs a single, fully validated
-- insert.
-- =============================================================================

create function public.submit_inquiry(
  p_property_slug        text,
  p_name                 text,
  p_phone                text,
  p_email                text,
  p_message              text,
  p_client_submission_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_name        text := nullif(btrim(p_name), '');
  v_phone       text := nullif(btrim(p_phone), '');
  v_email       text := nullif(lower(btrim(p_email)), '');
  v_message     text := nullif(btrim(p_message), '');
  v_property_id uuid;
  v_agency_id   uuid;
  v_recent      integer;
  v_inserted    uuid;
begin
  if p_client_submission_id is null
     or p_property_slug is null or p_property_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or char_length(p_property_slug) > 200
     or v_name is null or char_length(v_name) not between 2 and 120
     or v_phone is null or v_phone !~ '^\+?[0-9 ().-]{6,32}$'
     or char_length(regexp_replace(v_phone, '[^0-9]', '', 'g')) not between 7 and 15
     or (v_email is not null and (char_length(v_email) > 254 or v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'))
     or (v_message is not null and char_length(v_message) > 2000)
  then
    return jsonb_build_object('ok', false, 'error', 'invalid_input');
  end if;

  select p.id, p.agency_id
    into v_property_id, v_agency_id
  from public.properties p
  where p.slug = p_property_slug
    and p.listing_status = 'published';

  if v_property_id is null or v_agency_id is null then
    return jsonb_build_object('ok', false, 'error', 'property_unavailable');
  end if;

  -- Retry of the same form submission: report success, create nothing.
  if exists (
    select 1 from public.inquiries
    where agency_id = v_agency_id and client_submission_id = p_client_submission_id
  ) then
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;

  select count(*) into v_recent
  from public.inquiries
  where property_id = v_property_id
    and phone = v_phone
    and created_at > now() - interval '10 minutes';

  if v_recent >= 3 then
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;

  insert into public.inquiries (agency_id, property_id, name, phone, email, message, source, client_submission_id)
  values (v_agency_id, v_property_id, v_name, v_phone, v_email, v_message, 'website', p_client_submission_id)
  on conflict (agency_id, client_submission_id) where client_submission_id is not null do nothing
  returning id into v_inserted;

  return jsonb_build_object('ok', true, 'duplicate', v_inserted is null);
end;
$$;

comment on function public.submit_inquiry(text, text, text, text, text, uuid) is
  'Public, validated inquiry submission for a published listing (by slug). Returns {ok, error|duplicate} only.';

revoke all on function public.submit_inquiry(text, text, text, text, text, uuid) from public;
grant execute on function public.submit_inquiry(text, text, text, text, text, uuid) to anon, authenticated, service_role;
