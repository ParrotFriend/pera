-- Pera — Phase 1 schema (Supabase / Postgres)
-- Money is BIGINT minor units (centavos). Never numeric floats in the client.
-- Run in Supabase SQL editor, in order. Safe to re-run: uses IF NOT EXISTS where possible.

create extension if not exists pgcrypto;

-- ---------- helpers ----------
-- Server owns `version` and `server_updated_at`. Clients send the version they based an edit on
-- (as a WHERE filter), never the value itself.
create or replace function public.bump_version() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.version := 1;
  else
    new.version := old.version + 1;
    new.user_id := old.user_id;        -- ownership can never change
    new.created_at := old.created_at;
  end if;
  new.server_updated_at := now();
  return new;
end $$;

-- ---------- profiles ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text check (char_length(display_name) <= 80),
  currency char(3) not null default 'PHP',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name) values (new.id, coalesce(new.raw_user_meta_data->>'display_name', null))
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- ---------- accounts ----------
create table if not exists public.accounts (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  type text not null check (type in ('cash','ewallet','bank','savings','investment','credit_card','loan','other')),
  initial_balance bigint not null default 0,
  currency char(3) not null default 'PHP',
  description text not null default '' check (char_length(description) <= 500),
  icon text, color text,
  low_balance_threshold bigint check (low_balance_threshold is null or low_balance_threshold >= 0),
  include_in_total boolean not null default true,
  sort_order int not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz,
  version int not null default 1,
  server_updated_at timestamptz not null default now(),
  unique (id, user_id)
);
create index if not exists accounts_user_sync on public.accounts (user_id, server_updated_at);

-- ---------- categories ----------
create table if not exists public.categories (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('income','expense')),
  name text not null check (char_length(name) between 1 and 60),
  parent_id uuid,
  icon text, color text,
  archived_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz,
  version int not null default 1,
  server_updated_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (parent_id, user_id) references public.categories (id, user_id)
);
create index if not exists categories_user_sync on public.categories (user_id, server_updated_at);

-- ---------- transactions (the ledger — source of truth for every balance) ----------
create table if not exists public.transactions (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('income','expense','transfer','adjustment','refund')),
  amount bigint not null check (amount > 0),
  account_id uuid not null,
  to_account_id uuid,
  category_id uuid,
  direction text check (direction in ('in','out')),
  refund_of uuid,
  date date not null,               -- the user's LOCAL calendar date
  time text check (time ~ '^\d{2}:\d{2}$'),
  payee text not null default '' check (char_length(payee) <= 120),
  notes text not null default '' check (char_length(notes) <= 1000),
  tags text[] not null default '{}',
  created_by uuid,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz,           -- soft delete (Trash)
  purged_at timestamptz,            -- permanent delete tombstone (details wiped)
  version int not null default 1,
  server_updated_at timestamptz not null default now(),
  -- the account(s) and category must belong to the same user
  foreign key (account_id, user_id) references public.accounts (id, user_id),
  foreign key (to_account_id, user_id) references public.accounts (id, user_id),
  foreign key (category_id, user_id) references public.categories (id, user_id),
  -- accounting rules enforced by the database, not just the UI
  constraint transfer_shape check (
    (type = 'transfer' and to_account_id is not null and to_account_id <> account_id)
    or (type <> 'transfer' and to_account_id is null)),
  constraint category_required check (type not in ('income','expense') or category_id is not null),
  constraint adjustment_direction check ((type = 'adjustment') = (direction is not null))
);
create index if not exists tx_user_sync on public.transactions (user_id, server_updated_at);
create index if not exists tx_user_date on public.transactions (user_id, date desc);
create index if not exists tx_user_account on public.transactions (user_id, account_id);
create index if not exists tx_user_to_account on public.transactions (user_id, to_account_id) where to_account_id is not null;
create index if not exists tx_user_category on public.transactions (user_id, category_id);

-- ---------- audit log (append-only) ----------
create table if not exists public.audit_logs (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  entity text not null,
  entity_id uuid not null,
  action text not null check (action in ('created','updated','deleted','restored','archived','adjusted','transferred','purged','synced')),
  summary text not null default '',
  device text,
  at timestamptz not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz,
  version int not null default 1,
  server_updated_at timestamptz not null default now()
);
create index if not exists audit_user_sync on public.audit_logs (user_id, server_updated_at);
create index if not exists audit_entity on public.audit_logs (user_id, entity_id);

-- ---------- version triggers ----------
do $$ declare t text; begin
  foreach t in array array['accounts','categories','transactions','audit_logs'] loop
    execute format('drop trigger if exists %I_version on public.%I', t, t);
    execute format('create trigger %I_version before insert or update on public.%I for each row execute function public.bump_version()', t, t);
  end loop;
end $$;

-- ---------- Row Level Security: users only ever see their own rows ----------
alter table public.profiles enable row level security;
alter table public.accounts enable row level security;
alter table public.categories enable row level security;
alter table public.transactions enable row level security;
alter table public.audit_logs enable row level security;

drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles for all using (id = auth.uid()) with check (id = auth.uid());

do $$ declare t text; begin
  foreach t in array array['accounts','categories','transactions'] loop
    execute format('drop policy if exists "own rows select" on public.%I', t);
    execute format('drop policy if exists "own rows insert" on public.%I', t);
    execute format('drop policy if exists "own rows update" on public.%I', t);
    execute format('create policy "own rows select" on public.%I for select using (user_id = auth.uid())', t);
    execute format('create policy "own rows insert" on public.%I for insert with check (user_id = auth.uid())', t);
    execute format('create policy "own rows update" on public.%I for update using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
    -- No DELETE policy on purpose: financial rows are soft-deleted / tombstoned, never hard-deleted by clients.
  end loop;
end $$;

drop policy if exists "own audit select" on public.audit_logs;
drop policy if exists "own audit insert" on public.audit_logs;
create policy "own audit select" on public.audit_logs for select using (user_id = auth.uid());
create policy "own audit insert" on public.audit_logs for insert with check (user_id = auth.uid());
-- audit_logs: no update, no delete.
