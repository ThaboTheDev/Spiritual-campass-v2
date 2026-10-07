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
  revenuecat_status    text check (revenuecat_status is null or revenuecat_status in ('active','cancelled','expired','refunded')),
  revenuecat_entitlement_until timestamptz,
  revenuecat_event_timestamp_ms bigint,
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

-- RevenueCat webhook receipts store only the fields needed for idempotency and
-- ordered processing, not the full payload or its potentially identifying data.
create table if not exists public.revenuecat_events (
  event_id              text primary key,
  user_id               uuid not null references auth.users(id) on delete cascade,
  event_type            text not null,
  event_timestamp_ms    bigint not null,
  entitlement_ids       text[] not null default '{}',
  expiration_at         timestamptz,
  raw_payload           jsonb,
  outcome               text,
  received_at            timestamptz not null default now(),
  processed_at           timestamptz
);
create index if not exists revenuecat_events_user_idx on public.revenuecat_events(user_id);
alter table public.revenuecat_events add column if not exists entitlement_ids text[] not null default '{}';
alter table public.revenuecat_events add column if not exists expiration_at timestamptz;
alter table public.revenuecat_events alter column raw_payload drop not null;
update public.revenuecat_events
set entitlement_ids = case
      when jsonb_typeof(raw_payload #> '{event,entitlement_ids}') = 'array'
        then array(select jsonb_array_elements_text(raw_payload #> '{event,entitlement_ids}'))
      else entitlement_ids
    end,
    expiration_at = case
      when raw_payload #>> '{event,expiration_at_ms}' ~ '^[0-9]+$'
        then to_timestamp((raw_payload #>> '{event,expiration_at_ms}')::numeric / 1000.0)
      else expiration_at
    end
where raw_payload is not null;
update public.revenuecat_events set raw_payload = null where raw_payload is not null;

-- Event persistence, member update, and acknowledgement are one transaction.
-- Locking the member serializes concurrent notifications and timestamp-checks
-- prevent an older event from overwriting newer subscription state.
create or replace function public.process_revenuecat_event(
  p_event_id text,
  p_user_id uuid,
  p_event_type text,
  p_event_timestamp_ms bigint,
  p_entitlement_ids text[],
  p_expiration_at_ms bigint,
  p_outcome text,
  p_member_patch jsonb
) returns text
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  stored public.revenuecat_events%rowtype;
  current_timestamp_ms bigint;
begin
  perform 1 from public.members where user_id = p_user_id for update;
  if not found then
    return 'unknown_user';
  end if;

  insert into public.revenuecat_events (
    event_id, user_id, event_type, event_timestamp_ms, entitlement_ids, expiration_at
  ) values (
    p_event_id, p_user_id, p_event_type, p_event_timestamp_ms,
    coalesce(p_entitlement_ids, '{}'),
    case when p_expiration_at_ms is null then null else to_timestamp(p_expiration_at_ms / 1000.0) end
  ) on conflict (event_id) do nothing;

  select * into stored
  from public.revenuecat_events
  where event_id = p_event_id
  for update;

  if stored.user_id is distinct from p_user_id
     or stored.event_type is distinct from p_event_type
     or stored.event_timestamp_ms is distinct from p_event_timestamp_ms
     or stored.entitlement_ids is distinct from coalesce(p_entitlement_ids, '{}')
     or stored.expiration_at is distinct from
       (case when p_expiration_at_ms is null then null else to_timestamp(p_expiration_at_ms / 1000.0) end) then
    return 'event_id_conflict';
  end if;
  if stored.processed_at is not null then
    return 'duplicate';
  end if;

  select revenuecat_event_timestamp_ms into current_timestamp_ms
  from public.members where user_id = p_user_id;
  if current_timestamp_ms is not null and current_timestamp_ms >= stored.event_timestamp_ms then
    update public.revenuecat_events
    set outcome = 'stale', processed_at = now()
    where event_id = p_event_id;
    return 'stale';
  end if;

  if p_member_patch is not null then
    update public.members set
      revenuecat_status = case
        when p_member_patch ? 'revenuecat_status' then p_member_patch->>'revenuecat_status'
        else revenuecat_status
      end,
      revenuecat_entitlement_until = case
        when p_member_patch ? 'revenuecat_entitlement_until'
          then (p_member_patch->>'revenuecat_entitlement_until')::timestamptz
        else revenuecat_entitlement_until
      end,
      revenuecat_event_timestamp_ms = stored.event_timestamp_ms,
      updated_at = now()
    where user_id = p_user_id;
  end if;

  update public.revenuecat_events
  set outcome = p_outcome, processed_at = now()
  where event_id = p_event_id;
  return p_outcome;
end;
$$;
revoke all on function public.process_revenuecat_event(text, uuid, text, bigint, text[], bigint, text, jsonb) from public, anon, authenticated;
grant execute on function public.process_revenuecat_event(text, uuid, text, bigint, text[], bigint, text, jsonb) to service_role;
grant select, insert, update on public.revenuecat_events to service_role;

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
alter table public.revenuecat_events enable row level security;
revoke all on public.revenuecat_events from anon, authenticated;

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
alter table public.members  add column if not exists revenuecat_status text;
alter table public.members  add column if not exists revenuecat_entitlement_until timestamptz;
alter table public.members  add column if not exists revenuecat_event_timestamp_ms bigint;

-- Make yourself the first admin AFTER you have signed in to the app once (this creates your member row):
--   update public.members set is_admin = true where lower(email) = lower('you@example.org');
