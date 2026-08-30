
-- ============================================================================
-- Washero — Production schema (clean, idempotent)
-- ============================================================================

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- updated_at helper
-- ----------------------------------------------------------------------------
create or replace function public.update_updated_at_column()
returns trigger
language plpgsql
set search_path = public
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
  full_name     text not null,
  phone         text not null,
  email         text,
  address       text,
  neighborhood  text,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists customers_phone_idx        on public.customers (phone);
create index if not exists customers_email_idx        on public.customers (email);
create index if not exists customers_neighborhood_idx on public.customers (neighborhood);

drop trigger if exists customers_set_updated_at on public.customers;
create trigger customers_set_updated_at
before update on public.customers
for each row execute function public.update_updated_at_column();

-- ============================================================================
-- 2. service_areas
-- ============================================================================
create table if not exists public.service_areas (
  id              uuid primary key default gen_random_uuid(),
  name            text not null unique,
  active          boolean not null default true,
  coverage_notes  text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

drop trigger if exists service_areas_set_updated_at on public.service_areas;
create trigger service_areas_set_updated_at
before update on public.service_areas
for each row execute function public.update_updated_at_column();

-- ============================================================================
-- 3. services
-- ============================================================================
create table if not exists public.services (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  description       text,
  base_price        integer not null,
  duration_minutes  integer not null,
  active            boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

drop trigger if exists services_set_updated_at on public.services;
create trigger services_set_updated_at
before update on public.services
for each row execute function public.update_updated_at_column();

-- ============================================================================
-- 4. bookings
-- ============================================================================
create table if not exists public.bookings (
  id                uuid primary key default gen_random_uuid(),
  customer_id       uuid references public.customers(id) on delete set null,
  customer_name     text not null,
  customer_phone    text not null,
  customer_email    text,
  address           text not null,
  neighborhood      text not null,
  vehicle_type      text not null,
  service_id        uuid references public.services(id) on delete set null,
  service_name      text not null,
  scheduled_date    date not null,
  scheduled_time    time not null,
  duration_minutes  integer not null,
  price             integer not null,
  payment_method    text not null default 'Pagar después'
                      check (payment_method in ('MercadoPago','Transferencia','Pagar después')),
  payment_status    text not null default 'pending'
                      check (payment_status in ('pending','paid','failed','refunded','cancelled')),
  booking_status    text not null default 'pending'
                      check (booking_status in ('pending','confirmed','in_progress','completed','cancelled','needs_review')),
  booking_source    text not null default 'website'
                      check (booking_source in ('website','admin','botmaker','manual')),
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists bookings_customer_phone_idx on public.bookings (customer_phone);
create index if not exists bookings_scheduled_date_idx on public.bookings (scheduled_date);
create index if not exists bookings_scheduled_dt_idx   on public.bookings (scheduled_date, scheduled_time);
create index if not exists bookings_status_idx         on public.bookings (booking_status);
create index if not exists bookings_source_idx         on public.bookings (booking_source);
create index if not exists bookings_neighborhood_idx   on public.bookings (neighborhood);

drop trigger if exists bookings_set_updated_at on public.bookings;
create trigger bookings_set_updated_at
before update on public.bookings
for each row execute function public.update_updated_at_column();

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
  updated_at  timestamptz not null default now(),
  unique (date, start_time)
);
create index if not exists availability_date_idx    on public.availability_slots (date);
create index if not exists availability_date_st_idx on public.availability_slots (date, start_time);
create index if not exists availability_active_idx  on public.availability_slots (active);

drop trigger if exists availability_set_updated_at on public.availability_slots;
create trigger availability_set_updated_at
before update on public.availability_slots
for each row execute function public.update_updated_at_column();

-- ============================================================================
-- 6. admin_users
-- ============================================================================
create table if not exists public.admin_users (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,
  email       text not null unique,
  role        text not null default 'admin'
                check (role in ('owner','admin','operator')),
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists admin_users_user_id_idx on public.admin_users (user_id);
create index if not exists admin_users_email_idx   on public.admin_users (email);
create index if not exists admin_users_active_idx  on public.admin_users (active);

drop trigger if exists admin_users_set_updated_at on public.admin_users;
create trigger admin_users_set_updated_at
before update on public.admin_users
for each row execute function public.update_updated_at_column();

-- ============================================================================
-- 7. payments
-- ============================================================================
create table if not exists public.payments (
  id                   uuid primary key default gen_random_uuid(),
  booking_id           uuid references public.bookings(id) on delete cascade,
  provider             text not null check (provider in ('mercadopago','manual')),
  provider_payment_id  text,
  amount               integer not null,
  status               text not null default 'pending'
                         check (status in ('pending','paid','failed','refunded','cancelled')),
  raw_payload          jsonb,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index if not exists payments_booking_idx     on public.payments (booking_id);
create index if not exists payments_provider_idx    on public.payments (provider);
create index if not exists payments_provider_pid_idx on public.payments (provider_payment_id);
create index if not exists payments_status_idx      on public.payments (status);

drop trigger if exists payments_set_updated_at on public.payments;
create trigger payments_set_updated_at
before update on public.payments
for each row execute function public.update_updated_at_column();

-- ============================================================================
-- 8. booking_requests
-- ============================================================================
create table if not exists public.booking_requests (
  id                 uuid primary key default gen_random_uuid(),
  customer_name      text,
  customer_phone     text,
  customer_email     text,
  address            text,
  neighborhood       text,
  vehicle_type       text,
  service_type       text,
  preferred_date     date,
  preferred_time     time,
  payment_method     text,
  status             text not null default 'needs_review'
                       check (status in ('needs_review','approved','converted','waiting_customer','rejected','duplicate')),
  source             text not null default 'botmaker'
                       check (source in ('botmaker','webchat','whatsapp','admin','manual')),
  raw_payload        jsonb,
  missing_fields     jsonb,
  linked_booking_id  uuid references public.bookings(id) on delete set null,
  is_test            boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists br_customer_phone_idx on public.booking_requests (customer_phone);
create index if not exists br_preferred_date_idx on public.booking_requests (preferred_date);
create index if not exists br_status_idx         on public.booking_requests (status);
create index if not exists br_source_idx         on public.booking_requests (source);
create index if not exists br_is_test_idx        on public.booking_requests (is_test);
create index if not exists br_linked_booking_idx on public.booking_requests (linked_booking_id);

drop trigger if exists booking_requests_set_updated_at on public.booking_requests;
create trigger booking_requests_set_updated_at
before update on public.booking_requests
for each row execute function public.update_updated_at_column();

-- ============================================================================
-- 9. communication_logs
-- ============================================================================
create table if not exists public.communication_logs (
  id                  uuid primary key default gen_random_uuid(),
  customer_id         uuid references public.customers(id) on delete set null,
  booking_id          uuid references public.bookings(id) on delete set null,
  booking_request_id  uuid references public.booking_requests(id) on delete set null,
  provider            text not null check (provider in ('botmaker','whatsapp','email','system','manual')),
  channel             text not null check (channel  in ('whatsapp','webchat','email','admin','system')),
  direction           text not null check (direction in ('inbound','outbound','internal')),
  message_text        text,
  raw_payload         jsonb,
  created_at          timestamptz not null default now()
);
create index if not exists cl_customer_idx         on public.communication_logs (customer_id);
create index if not exists cl_booking_idx          on public.communication_logs (booking_id);
create index if not exists cl_booking_request_idx  on public.communication_logs (booking_request_id);
create index if not exists cl_provider_idx         on public.communication_logs (provider);
create index if not exists cl_channel_idx          on public.communication_logs (channel);
create index if not exists cl_created_at_idx       on public.communication_logs (created_at);

-- ============================================================================
-- Admin helper (security definer, no recursion)
-- ============================================================================
create or replace function public.is_admin()
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
-- RLS
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

-- Public reads
drop policy if exists "services public read" on public.services;
create policy "services public read" on public.services
  for select to anon, authenticated using (active = true);

drop policy if exists "service_areas public read" on public.service_areas;
create policy "service_areas public read" on public.service_areas
  for select to anon, authenticated using (active = true);

drop policy if exists "availability public read" on public.availability_slots;
create policy "availability public read" on public.availability_slots
  for select to anon, authenticated using (active = true);

-- Public insert: bookings (MVP only — safe defaults enforced)
drop policy if exists "bookings public insert" on public.bookings;
create policy "bookings public insert" on public.bookings
  for insert to anon, authenticated
  with check (
    booking_source = 'website'
    and booking_status in ('pending','needs_review')
    and payment_status = 'pending'
  );

-- Admin all-access
drop policy if exists "customers admin all" on public.customers;
create policy "customers admin all" on public.customers
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "service_areas admin all" on public.service_areas;
create policy "service_areas admin all" on public.service_areas
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "services admin all" on public.services;
create policy "services admin all" on public.services
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "bookings admin all" on public.bookings;
create policy "bookings admin all" on public.bookings
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "availability admin all" on public.availability_slots;
create policy "availability admin all" on public.availability_slots
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "payments admin all" on public.payments;
create policy "payments admin all" on public.payments
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "booking_requests admin all" on public.booking_requests;
create policy "booking_requests admin all" on public.booking_requests
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "comm_logs admin all" on public.communication_logs;
create policy "comm_logs admin all" on public.communication_logs
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- admin_users: admin read only (writes via service role)
drop policy if exists "admin_users admin read" on public.admin_users;
create policy "admin_users admin read" on public.admin_users
  for select to authenticated using (public.is_admin());

-- ============================================================================
-- SEED DATA (idempotent)
-- ============================================================================

-- Service areas
insert into public.service_areas (name, active) values
  ('Maschwitz',    true),
  ('Nordelta',     true),
  ('Escobar',      true),
  ('San Isidro',   true),
  ('Tigre',        true),
  ('Pilar',        true),
  ('Benavídez',    true),
  ('Villa Nueva',  true)
on conflict (name) do nothing;

-- Services (use a unique partial index for upsert by name)
create unique index if not exists services_name_unique_idx on public.services (name);

insert into public.services (name, description, base_price, duration_minutes, active) values
  ('Lavado Básico',
   'Lavado exterior, limpieza rápida interior y terminaciones básicas.',
   25000, 60, true),
  ('Lavado Completo',
   'Lavado exterior completo, interior, aspirado y terminaciones premium.',
   35000, 90, true)
on conflict (name) do nothing;

-- Availability slots — next 14 days, Mon–Sat, 09:00–18:00, every 90 min
insert into public.availability_slots (date, start_time, end_time, capacity, active)
select
  d::date,
  (make_time(9,0,0) + (n * interval '90 minutes'))::time as start_time,
  (make_time(9,0,0) + ((n+1) * interval '90 minutes'))::time as end_time,
  1,
  true
from generate_series(current_date, current_date + interval '13 days', interval '1 day') as d,
     generate_series(0, 5) as n
where extract(dow from d) <> 0  -- skip Sundays
  and (make_time(9,0,0) + ((n+1) * interval '90 minutes'))::time <= make_time(18,0,0)
on conflict (date, start_time) do nothing;
;
