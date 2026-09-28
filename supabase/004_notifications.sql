-- Pera — Phase 2, batch 3: push notifications
-- Run AFTER 003_bills_recurring.sql. Safe to re-run.

-- Each device/browser that turned notifications on.
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null check (char_length(endpoint) <= 1000),
  p256dh text not null,
  auth text not null,
  device text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  unique (user_id, endpoint)
);

-- One row per user: what to send and when.
create table if not exists public.notification_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default true,
  bills boolean not null default true,
  recurring boolean not null default true,
  debts boolean not null default true,
  budgets boolean not null default true,
  low_balance boolean not null default true,
  bill_days int[] not null default '{7,3,1,0}',
  send_hour int not null default 8 check (send_hour between 0 and 23),
  timezone text not null default 'Asia/Manila',
  currency char(3) not null default 'PHP',
  updated_at timestamptz not null default now()
);

-- Every reminder that was sent, so it is never sent twice. Only the server touches this table.
create table if not exists public.notification_log (
  user_id uuid not null references auth.users(id) on delete cascade,
  key text not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, key)
);

-- Current balance per account, computed from the ledger (used for low-balance alerts).
create or replace view public.account_balances with (security_invoker = on) as
select a.id, a.user_id, a.name, a.currency, a.low_balance_threshold, a.archived_at, a.deleted_at,
  a.initial_balance + coalesce(sum(
    case
      when t.type in ('income','refund') and t.account_id = a.id then t.amount
      when t.type = 'expense' and t.account_id = a.id then -t.amount
      when t.type = 'transfer' and t.account_id = a.id then -t.amount
      when t.type = 'transfer' and t.to_account_id = a.id then t.amount
      when t.type in ('adjustment','debt') and t.account_id = a.id then case when t.direction = 'out' then -t.amount else t.amount end
      else 0
    end), 0)::bigint as balance
from public.accounts a
left join public.transactions t
  on (t.account_id = a.id or t.to_account_id = a.id) and t.deleted_at is null and t.purged_at is null
group by a.id;

alter table public.push_subscriptions enable row level security;
alter table public.notification_settings enable row level security;
alter table public.notification_log enable row level security; -- no policies: clients can't read or write it

drop policy if exists "own subscriptions" on public.push_subscriptions;
create policy "own subscriptions" on public.push_subscriptions for all using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "own notification settings" on public.notification_settings;
create policy "own notification settings" on public.notification_settings for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create index if not exists notification_log_sent on public.notification_log (sent_at);