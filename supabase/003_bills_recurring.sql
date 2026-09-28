-- Pera — Phase 2, batch 2: bills + recurring transactions ("schedules")
-- Run AFTER 002_phase2_budgets_debts.sql. Safe to re-run.

create table if not exists public.schedules (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('bill','recurring')),
  name text not null check (char_length(name) between 1 and 80),
  type text not null check (type in ('income','expense','transfer')),
  amount bigint check (amount is null or amount > 0),
  variable_amount boolean not null default false,
  account_id uuid not null,
  to_account_id uuid,
  category_id uuid,
  payee text not null default '',
  notes text not null default '' check (char_length(notes) <= 500),
  frequency text not null check (frequency in ('daily','weekly','biweekly','monthly','quarterly','yearly','custom')),
  interval int check (interval is null or interval between 1 and 365),
  interval_unit text check (interval_unit is null or interval_unit in ('day','week','month')),
  start_date date not null,
  end_date date,
  max_count int check (max_count is null or max_count > 0),
  effective_from date,
  auto boolean not null default false,
  skipped date[] not null default '{}',
  paused_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz,
  version int not null default 1,
  server_updated_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (account_id, user_id) references public.accounts (id, user_id),
  foreign key (to_account_id, user_id) references public.accounts (id, user_id),
  foreign key (category_id, user_id) references public.categories (id, user_id),
  constraint schedule_amount check (amount is not null or (kind = 'bill' and variable_amount)),
  constraint schedule_transfer check ((type = 'transfer') = (to_account_id is not null)),
  constraint schedule_custom check (frequency <> 'custom' or (interval is not null and interval_unit is not null))
);
create index if not exists schedules_user_sync on public.schedules (user_id, server_updated_at);

-- Transactions created from a bill/recurring schedule remember which one and which due date.
alter table public.transactions add column if not exists schedule_id uuid;
alter table public.transactions add column if not exists occurrence_date date;
alter table public.transactions drop constraint if exists transactions_schedule_fk;
alter table public.transactions add constraint transactions_schedule_fk foreign key (schedule_id, user_id) references public.schedules (id, user_id);
create index if not exists tx_user_schedule on public.transactions (user_id, schedule_id) where schedule_id is not null;

drop trigger if exists schedules_version on public.schedules;
create trigger schedules_version before insert or update on public.schedules for each row execute function public.bump_version();
alter table public.schedules enable row level security;
drop policy if exists "own rows select" on public.schedules;
drop policy if exists "own rows insert" on public.schedules;
drop policy if exists "own rows update" on public.schedules;
create policy "own rows select" on public.schedules for select using (user_id = auth.uid());
create policy "own rows insert" on public.schedules for insert with check (user_id = auth.uid());
create policy "own rows update" on public.schedules for update using (user_id = auth.uid()) with check (user_id = auth.uid());