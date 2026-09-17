-- ---------------------------------------------------------------------------
-- Scheduled jobs.
--
-- Apply this AFTER deploying the edge function and setting the vault secrets
-- below, because pg_cron needs the project URL and service key to call it.
--
--   supabase functions deploy viewing-reminders
--   supabase secrets set TELEGRAM_BOT_TOKEN=... TELEGRAM_CHAT_ID=... SITE_URL=...
--
-- Then, once, in the SQL editor:
--   select vault.create_secret('https://<ref>.supabase.co', 'project_url');
--   select vault.create_secret('<service-role-key>', 'service_role_key');
--
-- The reminder job is idempotent: viewing_bookings.reminder_sent_at means a
-- double-fire cannot message a customer twice.
-- ---------------------------------------------------------------------------

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

-- Hourly is the right cadence for a 24-hour reminder: it bounds how far off
-- "24 hours before" can land without sending anyone a 3am notification run.
select cron.schedule(
  'vip-viewing-reminders',
  '0 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
           || '/functions/v1/viewing-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Safety net if the edge function is ever unavailable: the queue still fills,
-- so nothing is missed once delivery resumes.
select cron.schedule(
  'vip-viewing-queue-reminders',
  '*/15 * * * *',
  $$ select public.queue_viewing_reminders(
       coalesce((public.viewing_setting('booking', '{}'::jsonb) ->> 'reminder_hours_before')::int, 24)); $$
);

select cron.schedule(
  'vip-viewing-expire-confirmations',
  '30 * * * *',
  $$ select public.expire_viewing_confirmations(); $$
);

-- To remove:  select cron.unschedule('vip-viewing-reminders');
