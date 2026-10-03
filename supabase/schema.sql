-- TSHK Compass subscription edition: run once in Supabase → SQL Editor.

create table if not exists public.members (
  user_id              uuid primary key references auth.users(id) on delete cascade,
  email                text,
  status               text not null default 'trialing'
                       check (status in ('trialing','active','cancelled')),
  trial_ends_at        timestamptz not null,
  paid_through         timestamptz,            -- end of the month already paid for
  payfast_token        text unique,            -- PayFast subscription token (needed to cancel)
  cancel_requested_at  timestamptz,
  subscription_amount  numeric(10,2),          -- monthly amount this member signed up at (renewals are checked against it)
  is_admin             boolean not null default false,   -- may use the admin area (set by hand in SQL, never by the app)
  must_change_password boolean not null default false,   -- true after an admin resets the password: the member must choose their own
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create table if not exists public.checkouts (
  m_payment_id  text primary key,              -- our reference sent to PayFast
  user_id       uuid not null references auth.users(id) on delete cascade,
  amount        numeric(10,2) not null,
  status        text not null default 'pending', -- pending | complete | cancelled
  created_at    timestamptz not null default now()
);

create table if not exists public.payments (
  id             bigserial primary key,
  user_id        uuid references auth.users(id) on delete set null,
  pf_payment_id  text unique,                  -- PayFast's id; unique = each notification is applied once
  m_payment_id   text,
  token          text,
  payment_status text,
  amount_gross   numeric(10,2),
  amount_fee     numeric(10,2),
  amount_net     numeric(10,2),
  raw            jsonb,
  applies_until  timestamptz,                  -- paid-through date this payment grants; lets a retried notification finish an interrupted activation
  received_at    timestamptz not null default now()
);
create index if not exists payments_user_idx on public.payments(user_id);

-- Centres directory. Served by /api/centres to members with access and edited from the admin area.
-- RLS is on with NO policies, so only the server (service role key) can read or write it.
create table if not exists public.centres (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  region      text not null,
  address     text not null default '',
  town        text not null default '',
  phone       text not null default '',
  lat         double precision,
  lng         double precision,
  verified    boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint centres_lat_ok check (lat is null or (lat between -90 and 90)),
  constraint centres_lng_ok check (lng is null or (lng between -180 and 180))
);
create unique index if not exists centres_region_name_uq on public.centres (region, lower(name));

-- Row Level Security: members may read their own row; all writes happen on the server with the service role key.
alter table public.members   enable row level security;
alter table public.checkouts enable row level security;
alter table public.payments  enable row level security;
alter table public.centres   enable row level security;

drop policy if exists "members read own row" on public.members;
create policy "members read own row" on public.members for select using (auth.uid() = user_id);
drop policy if exists "members read own payments" on public.payments;
create policy "members read own payments" on public.payments for select using (auth.uid() = user_id);

-- Handy admin view: who is paying, trialling or lapsed.
create or replace view public.member_overview as
select m.email, m.status, m.is_admin, m.trial_ends_at, m.paid_through, m.cancel_requested_at, m.created_at,
       (select count(*) from public.payments p where p.user_id = m.user_id and p.payment_status = 'COMPLETE') as payments
from public.members m order by m.created_at desc;
revoke all on public.member_overview from anon, authenticated;

-- Upgrading an existing database? These are safe to run again:
alter table public.members  add column if not exists subscription_amount numeric(10,2);
alter table public.payments add column if not exists applies_until timestamptz;
alter table public.members  add column if not exists is_admin boolean not null default false;
alter table public.members  add column if not exists must_change_password boolean not null default false;

-- Make yourself the first admin AFTER you have signed in to the app once (this creates your member row):
--   update public.members set is_admin = true where lower(email) = lower('you@example.org');
