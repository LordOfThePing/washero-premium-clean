-- Rolling availability generator.
--
-- Problem: availability_slots was populated by hand and simply ran out. On 2026-08-02 the last
-- slot on record was 2026-07-31, so get-public-availability (website) and the Botmaker
-- availability action both returned zero options and no one could book anything.
--
-- Fix: one idempotent generator plus a daily pg_cron job, so the table always holds ~3 months
-- of future slots without anybody remembering to top it up.
--
-- Business hours (Argentina): Mon-Fri 09:00-18:00, Sat 09:00-13:00, Sun closed.
-- Slots are 1 hour long, so the last start is 17:00 on weekdays and 12:00 on Saturdays;
-- the latest end_time of the day is what booking-core uses as the operating-day end.
--
-- Safety: INSERT ... ON CONFLICT (date, start_time) DO NOTHING. Existing rows are never
-- updated, so slots that an admin disabled (active = false), re-priced or re-timed keep their
-- values, and historical dates before p_start_date are never touched.
--
-- Manual run:
--   select * from public.generate_availability_slots();        -- default 90 days from today (AR)
--   select * from public.generate_availability_slots(120);     -- custom horizon
--   select * from public.generate_availability_slots(30, date "2027-01-01");
--
-- Schedule: cron job "washero-generate-availability", daily at 06:10 UTC (03:10 in Buenos
-- Aires). Inspect with: select * from cron.job;  /  select * from cron.job_run_details;
--
-- ROLLBACK:
--   select cron.unschedule(jobid) from cron.job where jobname = 'washero-generate-availability';
--   drop function if exists public.generate_availability_slots(integer, date);

-- Self-hosted note: the Supabase postgres image only allows `create extension pg_cron` inside
-- a database literally named "postgres" (a hardcoded restriction independent of the
-- cron.database_name GUC), which this stack's "washero" database isn't. Rather than fail the
-- whole migration over an optional scheduling nicety, this is best-effort: if pg_cron can't be
-- installed here, generate_availability_slots() still gets created and seeded below, and you
-- need an external periodic trigger instead (host crontab running
-- `psql ... -c "select public.generate_availability_slots(97);"`, or an n8n Schedule Trigger
-- workflow calling the same). See selfhost/scripts/migrate.sh's RUN_OPTIONAL_SCHEDULES for the
-- older bash-based equivalent of this same gate.
do $pgcron$
begin
  create extension if not exists pg_cron;
exception when others then
  raise warning 'pg_cron unavailable (%), skipping schedule -- see comment above generate_availability_slots for the self-hosted alternative.', sqlerrm;
end;
$pgcron$;

create or replace function public.generate_availability_slots(
  p_days integer default 90,
  p_start_date date default null
)
returns table(inserted_count integer, from_date date, to_date date)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_start date;
  v_end date;
  v_ins integer;
begin
  v_start := coalesce(p_start_date, (now() at time zone 'America/Argentina/Buenos_Aires')::date);
  v_end := v_start + (greatest(p_days, 1) - 1);

  with cal as (
    select d::date as d, extract(isodow from d)::int as dow
    from generate_series(v_start::timestamp, v_end::timestamp, interval '1 day') d
  ),
  wanted as (
    select c.d as d,
           (lpad(g.h::text, 2, '0') || ':00:00')::time as st,
           (lpad((g.h + 1)::text, 2, '0') || ':00:00')::time as et
    from cal c
    cross join lateral (
      select generate_series(
        9,
        case when c.dow between 1 and 5 then 17
             when c.dow = 6 then 12
             else -1 end
      ) as h
    ) g
    where c.dow <= 6
  )
  insert into public.availability_slots (date, start_time, end_time, capacity, active)
  select w.d, w.st, w.et, 1, true from wanted w
  on conflict (date, start_time) do nothing;

  get diagnostics v_ins = row_count;
  return query select v_ins, v_start, v_end;
end;
$fn$;

comment on function public.generate_availability_slots(integer, date) is
  'Idempotent rolling availability generator. Mon-Fri 09:00-17:00 starts, Sat 09:00-12:00 starts, Sun closed, 1h slots, capacity 1. ON CONFLICT (date,start_time) DO NOTHING so booked/blocked/edited slots are never overwritten. Never touches dates before p_start_date (defaults to today in America/Argentina/Buenos_Aires).';

revoke all on function public.generate_availability_slots(integer, date) from public;
revoke all on function public.generate_availability_slots(integer, date) from anon, authenticated;
grant execute on function public.generate_availability_slots(integer, date) to service_role;

-- Seed the current window immediately, then keep it topped up every night.
select public.generate_availability_slots(97);

do $schedule$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'washero-generate-availability';
  perform cron.schedule(
    'washero-generate-availability',
    '10 6 * * *',
    $job$ select public.generate_availability_slots(97); $job$
  );
exception when others then
  raise warning 'pg_cron scheduling skipped (%) -- set up an external periodic trigger for generate_availability_slots(97) instead.', sqlerrm;
end;
$schedule$;
