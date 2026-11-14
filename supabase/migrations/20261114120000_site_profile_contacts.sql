-- =============================================================================
-- Site profile: second public phone, Russian/English office address and hours.
--
-- Additive and nullable only: no existing column, value, policy or function changes.
--   agencies.public_phone_secondary            a second public number (E.164), shown next to the first
--   agencies.office_address_ru / _en           the office address in Russian / English
--   agencies.office_hours_ru   / _en           the opening hours in Russian / English
-- The existing office_address / office_hours stay the Armenian (default) values; the website shows
-- the visitor's language when it is set and the Armenian value otherwise (lib/site/profile.server.ts).
--
-- public_site_profile is re-created with the same columns in the same order plus the new ones at the
-- end (CREATE OR REPLACE VIEW only appends), and anonymous readers get column-level SELECT on exactly
-- these new columns, as for the existing profile columns (migration 20260919174322).
--
-- Rollback: drop the five columns (the view must be re-created first without them):
--   create or replace view ... (the 20260919174322 definition); alter table public.agencies drop column ...
-- =============================================================================

alter table public.agencies
  add column public_phone_secondary text,
  add column office_address_ru      text,
  add column office_address_en      text,
  add column office_hours_ru        text,
  add column office_hours_en        text;

alter table public.agencies
  add constraint agencies_public_phone_secondary_e164 check (public_phone_secondary ~ '^\+[1-9][0-9]{6,14}$'),
  add constraint agencies_office_address_i18n_check check (
    (office_address_ru is null or (btrim(office_address_ru) <> '' and char_length(office_address_ru) <= 200
                                   and office_address_ru !~ '[[:cntrl:]]'))
    and (office_address_en is null or (btrim(office_address_en) <> '' and char_length(office_address_en) <= 200
                                       and office_address_en !~ '[[:cntrl:]]'))
  ),
  add constraint agencies_office_hours_i18n_check check (
    (office_hours_ru is null or (btrim(office_hours_ru) <> '' and char_length(office_hours_ru) <= 120
                                 and office_hours_ru !~ '[[:cntrl:]]'))
    and (office_hours_en is null or (btrim(office_hours_en) <> '' and char_length(office_hours_en) <= 120
                                     and office_hours_en !~ '[[:cntrl:]]'))
  );

comment on column public.agencies.public_phone_secondary is 'Second public phone (E.164), shown on the website next to public_phone.';
comment on column public.agencies.office_address_ru is 'Office address in Russian; the website falls back to office_address.';
comment on column public.agencies.office_address_en is 'Office address in English; the website falls back to office_address.';
comment on column public.agencies.office_hours_ru is 'Opening hours in Russian; the website falls back to office_hours.';
comment on column public.agencies.office_hours_en is 'Opening hours in English; the website falls back to office_hours.';

grant select (public_phone_secondary, office_address_ru, office_address_en, office_hours_ru, office_hours_en)
  on public.agencies to anon, authenticated;

create or replace view public.public_site_profile
with (security_invoker = true) as
select a.display_name, a.legal_name, a.public_phone, a.public_whatsapp, a.public_email, a.office_address,
       a.office_hours,
       a.public_phone_secondary, a.office_address_ru, a.office_address_en, a.office_hours_ru, a.office_hours_en
  from public.agencies a
 where a.is_site_primary and a.is_active;

revoke all on table public.public_site_profile from anon, authenticated;
grant select on table public.public_site_profile to anon, authenticated;
