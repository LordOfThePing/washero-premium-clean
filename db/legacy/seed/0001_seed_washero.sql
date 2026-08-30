-- Washero — Seed data
-- Idempotent: safe to re-run.

-- ============================================================================
-- Service areas
-- ============================================================================
insert into public.service_areas (name, active) values
  ('Maschwitz',  true),
  ('Nordelta',   true),
  ('Escobar',    true),
  ('San Isidro', true),
  ('Tigre',      true),
  ('Pilar',      true)
on conflict (name) do nothing;

-- ============================================================================
-- Services
-- ============================================================================
insert into public.services (name, description, base_price, duration_minutes, active) values
  ('Lavado Básico',
   'Lavado exterior, secado y limpieza rápida de interior.',
   12000, 45, true),
  ('Lavado Completo',
   'Lavado exterior premium, encerado, aspirado completo y limpieza detallada de interior.',
   22000, 90, true)
on conflict (name) do nothing;

-- ============================================================================
-- Availability slots — next 14 days, 9:00 to 18:00 (hourly), Mon–Sat
-- ============================================================================
insert into public.availability_slots (date, start_time, end_time, capacity, active)
select
  d::date,
  (h || ':00')::time,
  ((h + 1) || ':00')::time,
  1,
  true
from generate_series(current_date, current_date + interval '13 days', interval '1 day') as d,
     generate_series(9, 17) as h
where extract(dow from d) <> 0  -- skip Sundays (0 = Sunday)
on conflict (date, start_time, end_time) do nothing;
