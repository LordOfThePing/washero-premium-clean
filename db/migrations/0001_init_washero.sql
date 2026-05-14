-- Washero — Production schema (external Supabase)
-- Run this on YOUR external Supabase project (SQL Editor) in order:
--   1) db/migrations/0001_init_washero.sql
--   2) db/seed/0001_seed_washero.sql
-- This project does NOT use Lovable Cloud. The SQL is intentionally kept
-- in db/ (not supabase/migrations) so it is not coupled to any internal
-- migration system.

-- ============================================================================
-- Extensions
-- ============================================================================
create extension if not exists "pgcrypto";

-- ============================================================================
-- Helper: updated_at trigger
-- ============================================================================
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ============================================================================
-- 1. customers
-- ============================================================================
create table if not exists public.customers (
  id            uuid primary key default gen_random_uuid(),
  full_name     text,
  phone         text,
  email         text,
  address       text,
  neighborhood  text,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists customers_phone_idx on public.customers (phone);
create index if not exists customers_email_idx on public.customers (email);

drop trigger if exists customers_set_updated_at on public.customers;
create trigger customers_set_updated_at
before update on public.customers
for each row execute function public.set_updated_at();

-- ============================================================================
-- 2. service_areas
-- ============================================================================
create table if not exists public.service_areas (
  id              uuid primary key default gen_random_uuid(),
  name            text not null unique,
  active          boolean not null default true,
  coverage_notes  text,
  created_at      timestamptz not null default now()
);

-- ============================================================================
-- 3. services
-- ============================================================================
create table if not exists public.services (
  id                uuid primary key default gen_random_uuid(),
  name              text not null unique,
  description       text,
  base_price        integer not null default 0,
  duration_minutes  integer not null default 60,
  active            boolean not null default true,
  created_at        timestamptz not null default now()
);

-- ============================================================================
-- 4. bookings
-- ============================================================================
create table if not exists public.bookings (
  id                uuid primary key default gen_random_uuid(),
  customer_id       uuid references public.customers(id) on delete set null,
  customer_name     text,
  customer_phone    text,
  address           text,
  neighborhood      text,
  vehicle_type      text,
  service_id        uuid references public.services(id) on delete set null,
  service_name      text,
  scheduled_date    date,
  scheduled_time    time,
  duration_minutes  integer,
  price             integer,
  payment_method    text,
  payment_status    text,
  booking_status    text not null default 'pending'
                      check (booking_status in
                        ('pending','confirmed','in_progress','completed','cancelled','needs_review')),
  booking_source    text not null default 'website'
                      check (booking_source in ('website','admin','botmaker','manual')),
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists bookings_scheduled_date_idx on public.bookings (scheduled_date);
create index if not exists bookings_status_idx on public.bookings (booking_status);
create index if not exists bookings_customer_idx on public.bookings (customer_id);

drop trigger if exists bookings_set_updated_at on public.bookings;
create trigger bookings_set_updated_at
before update on public.bookings
for each row execute function public.set_updated_at();

-- ============================================================================
-- 5. availability_slots
-- ============================================================================
create table if not exists public.availability_slots (
  id          uuid primary key default gen_random_uuid(),
  date        date not null,
  start_time  time not null,
  end_time    time not null,
  capacity    integer not null default 1,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (date, start_time, end_time)
);
create index if not exists availability_date_idx on public.availability_slots (date);

-- ============================================================================
-- 6. admin_users
-- ============================================================================
create table if not exists public.admin_users (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid unique,            -- references auth.users.id
  email       text unique,
  role        text not null default 'admin',
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- ============================================================================
-- 7. payments
-- ============================================================================
create table if not exists public.payments (
  id                   uuid primary key default gen_random_uuid(),
  booking_id           uuid references public.bookings(id) on delete cascade,
  provider             text,
  provider_payment_id  text,
  amount               integer,
  status               text,
  raw_payload          jsonb,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index if not exists payments_booking_idx on public.payments (booking_id);

drop trigger if exists payments_set_updated_at on public.payments;
create trigger payments_set_updated_at
before update on public.payments
for each row execute function public.set_updated_at();

-- ============================================================================
-- 8. booking_requests
-- ============================================================================
create table if not exists public.booking_requests (
  id                 uuid primary key default gen_random_uuid(),
  customer_name      text,
  customer_phone     text,
  address            text,
  neighborhood       text,
  vehicle_type       text,
  service_type       text,
  preferred_date     date,
  preferred_time     time,
  payment_method     text,
  status             text not null default 'pending',
  source             text,
  raw_payload        jsonb,
  missing_fields     jsonb,
  linked_booking_id  uuid references public.bookings(id) on delete set null,
  is_test            boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists booking_requests_status_idx on public.booking_requests (status);

drop trigger if exists booking_requests_set_updated_at on public.booking_requests;
create trigger booking_requests_set_updated_at
before update on public.booking_requests
for each row execute function public.set_updated_at();

-- ============================================================================
-- 9. communication_logs
-- ============================================================================
create table if not exists public.communication_logs (
  id                  uuid primary key default gen_random_uuid(),
  customer_id         uuid references public.customers(id) on delete set null,
  booking_id          uuid references public.bookings(id) on delete set null,
  booking_request_id  uuid references public.booking_requests(id) on delete set null,
  provider            text,
  channel             text,
  direction           text,
  message_text        text,
  raw_payload         jsonb,
  created_at          timestamptz not null default now()
);
create index if not exists comm_logs_customer_idx on public.communication_logs (customer_id);
create index if not exists comm_logs_booking_idx  on public.communication_logs (booking_id);

-- ============================================================================
-- Security definer: is_active_admin()
-- Avoids recursive RLS by checking admin_users with elevated privileges.
-- ============================================================================
create or replace function public.is_active_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.admin_users
    where user_id = auth.uid() and active = true
  );
$$;

-- ============================================================================
-- RLS — enable on all tables
-- ============================================================================
alter table public.customers          enable row level security;
alter table public.service_areas      enable row level security;
alter table public.services           enable row level security;
alter table public.bookings           enable row level security;
alter table public.availability_slots enable row level security;
alter table public.admin_users        enable row level security;
alter table public.payments           enable row level security;
alter table public.booking_requests   enable row level security;
alter table public.communication_logs enable row level security;

-- ----------------------------------------------------------------------------
-- Public read policies (catalog data the website needs)
-- ----------------------------------------------------------------------------
drop policy if exists "services public read"      on public.services;
create policy "services public read" on public.services
  for select to anon, authenticated using (active = true);

drop policy if exists "service_areas public read" on public.service_areas;
create policy "service_areas public read" on public.service_areas
  for select to anon, authenticated using (active = true);

drop policy if exists "availability public read"  on public.availability_slots;
create policy "availability public read" on public.availability_slots
  for select to anon, authenticated using (active = true);

-- ----------------------------------------------------------------------------
-- booking_requests — public can INSERT (intake from website / botmaker).
-- No public read/update/delete. Admin sees everything.
-- Real `bookings` rows are created server-side (service role) from these.
-- ----------------------------------------------------------------------------
drop policy if exists "booking_requests public insert" on public.booking_requests;
create policy "booking_requests public insert" on public.booking_requests
  for insert to anon, authenticated with check (true);

drop policy if exists "booking_requests admin all" on public.booking_requests;
create policy "booking_requests admin all" on public.booking_requests
  for all to authenticated
  using (public.is_active_admin())
  with check (public.is_active_admin());

-- ----------------------------------------------------------------------------
-- bookings / customers / payments / communication_logs — admin only.
-- ----------------------------------------------------------------------------
drop policy if exists "bookings admin all" on public.bookings;
create policy "bookings admin all" on public.bookings
  for all to authenticated
  using (public.is_active_admin())
  with check (public.is_active_admin());

drop policy if exists "customers admin all" on public.customers;
create policy "customers admin all" on public.customers
  for all to authenticated
  using (public.is_active_admin())
  with check (public.is_active_admin());

drop policy if exists "payments admin all" on public.payments;
create policy "payments admin all" on public.payments
  for all to authenticated
  using (public.is_active_admin())
  with check (public.is_active_admin());

drop policy if exists "comm_logs admin all" on public.communication_logs;
create policy "comm_logs admin all" on public.communication_logs
  for all to authenticated
  using (public.is_active_admin())
  with check (public.is_active_admin());

-- ----------------------------------------------------------------------------
-- admin_users — readable by self or other admins; writes only via service role.
-- ----------------------------------------------------------------------------
drop policy if exists "admin_users self read" on public.admin_users;
create policy "admin_users self read" on public.admin_users
  for select to authenticated
  using (user_id = auth.uid() or public.is_active_admin());

-- ----------------------------------------------------------------------------
-- services / service_areas / availability_slots — admin manage (writes).
-- Public reads already allowed above.
-- ----------------------------------------------------------------------------
drop policy if exists "services admin write" on public.services;
create policy "services admin write" on public.services
  for all to authenticated
  using (public.is_active_admin())
  with check (public.is_active_admin());

drop policy if exists "service_areas admin write" on public.service_areas;
create policy "service_areas admin write" on public.service_areas
  for all to authenticated
  using (public.is_active_admin())
  with check (public.is_active_admin());

drop policy if exists "availability admin write" on public.availability_slots;
create policy "availability admin write" on public.availability_slots
  for all to authenticated
  using (public.is_active_admin())
  with check (public.is_active_admin());
