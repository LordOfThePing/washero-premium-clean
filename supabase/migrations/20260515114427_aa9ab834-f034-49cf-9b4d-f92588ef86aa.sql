-- Migration-replay compatibility fix: this file is a byte-for-byte duplicate of the immediately
-- preceding migration (20260515114425_.sql), which already created these tables/policies/
-- triggers and seeded weekly_availability_rules. Replayed from scratch against an empty
-- database the unguarded CREATE TABLE errors before ever reaching the INSERT. Made idempotent
-- with the same IF NOT EXISTS / DROP+CREATE / ON CONFLICT guards used throughout this migration
-- history — no behavior change anywhere this file previously succeeded.

-- early_access_leads
create table if not exists public.early_access_leads (
  id uuid primary key default gen_random_uuid(),
  full_name text,
  phone text,
  email text,
  neighborhood text,
  source text not null default 'manual',
  notes text,
  status text not null default 'new',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.early_access_leads enable row level security;
drop policy if exists "early_access admin all" on public.early_access_leads;
create policy "early_access admin all" on public.early_access_leads
  for all to authenticated using (is_admin()) with check (is_admin());
drop trigger if exists early_access_leads_updated_at on public.early_access_leads;
create trigger early_access_leads_updated_at
  before update on public.early_access_leads
  for each row execute function public.update_updated_at_column();

-- kipper_leads
create table if not exists public.kipper_leads (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid,
  booking_id uuid,
  full_name text,
  phone text,
  email text,
  status text not null default 'pending',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.kipper_leads enable row level security;
drop policy if exists "kipper_leads admin all" on public.kipper_leads;
create policy "kipper_leads admin all" on public.kipper_leads
  for all to authenticated using (is_admin()) with check (is_admin());
drop trigger if exists kipper_leads_updated_at on public.kipper_leads;
create trigger kipper_leads_updated_at
  before update on public.kipper_leads
  for each row execute function public.update_updated_at_column();

-- invoices
create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid,
  invoice_number text,
  status text not null default 'pending',
  issued_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.invoices enable row level security;
drop policy if exists "invoices admin all" on public.invoices;
create policy "invoices admin all" on public.invoices
  for all to authenticated using (is_admin()) with check (is_admin());
drop trigger if exists invoices_updated_at on public.invoices;
create trigger invoices_updated_at
  before update on public.invoices
  for each row execute function public.update_updated_at_column();

-- weekly_availability_rules
create table if not exists public.weekly_availability_rules (
  id uuid primary key default gen_random_uuid(),
  day_of_week int not null unique check (day_of_week between 0 and 6),
  day_name text not null,
  is_open boolean not null default true,
  start_time time not null default '09:00',
  end_time time not null default '18:00',
  slot_duration_minutes int not null default 90,
  interval_minutes int not null default 90,
  capacity int not null default 1,
  allow_overlaps boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.weekly_availability_rules enable row level security;
drop policy if exists "weekly_rules admin all" on public.weekly_availability_rules;
create policy "weekly_rules admin all" on public.weekly_availability_rules
  for all to authenticated using (is_admin()) with check (is_admin());
drop trigger if exists weekly_rules_updated_at on public.weekly_availability_rules;
create trigger weekly_rules_updated_at
  before update on public.weekly_availability_rules
  for each row execute function public.update_updated_at_column();

insert into public.weekly_availability_rules (day_of_week, day_name, is_open, start_time, end_time, slot_duration_minutes, interval_minutes, capacity, allow_overlaps) values
  (0, 'Domingo', false, '09:00', '18:00', 90, 90, 1, false),
  (1, 'Lunes', true, '09:00', '18:00', 90, 90, 1, false),
  (2, 'Martes', true, '09:00', '18:00', 90, 90, 1, false),
  (3, 'Miércoles', true, '09:00', '18:00', 90, 90, 1, false),
  (4, 'Jueves', true, '09:00', '18:00', 90, 90, 1, false),
  (5, 'Viernes', true, '09:00', '18:00', 90, 90, 1, false),
  (6, 'Sábado', true, '09:00', '18:00', 90, 90, 1, false)
on conflict (day_of_week) do nothing;

-- availability_exceptions
create table if not exists public.availability_exceptions (
  id uuid primary key default gen_random_uuid(),
  date date not null unique,
  is_closed boolean not null default true,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.availability_exceptions enable row level security;
drop policy if exists "availability_exceptions admin all" on public.availability_exceptions;
create policy "availability_exceptions admin all" on public.availability_exceptions
  for all to authenticated using (is_admin()) with check (is_admin());
drop trigger if exists availability_exceptions_updated_at on public.availability_exceptions;
create trigger availability_exceptions_updated_at
  before update on public.availability_exceptions
  for each row execute function public.update_updated_at_column();
