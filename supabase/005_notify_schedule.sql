-- Pera — run the "notify" Edge Function every hour.
-- BEFORE RUNNING: replace the two placeholders below.
--   YOUR-PROJECT-REF  → from your Supabase URL, e.g. https://abcdxyz.supabase.co → abcdxyz
--   YOUR-CRON-SECRET  → the same value you saved as the CRON_SECRET Edge Function secret
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Keep the URL and secret in Supabase Vault (encrypted), not in the job text.
select vault.create_secret('https://YOUR-PROJECT-REF.supabase.co/functions/v1/notify', 'pera_notify_url')
where not exists (select 1 from vault.secrets where name = 'pera_notify_url');
select vault.create_secret('YOUR-CRON-SECRET', 'pera_cron_secret')
where not exists (select 1 from vault.secrets where name = 'pera_cron_secret');

select cron.unschedule('pera-notify') where exists (select 1 from cron.job where jobname = 'pera-notify');
select cron.schedule('pera-notify', '5 * * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'pera_notify_url'),
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'pera_cron_secret')),
    body := '{}'::jsonb
  );
$$);

-- Clean up the sent-reminder log after 90 days (daily at 03:00 UTC).
select cron.unschedule('pera-notify-cleanup') where exists (select 1 from cron.job where jobname = 'pera-notify-cleanup');
select cron.schedule('pera-notify-cleanup', '0 3 * * *', $$ delete from public.notification_log where sent_at < now() - interval '90 days' $$);