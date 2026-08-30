-- Migration-replay compatibility fix: public.rls_auto_enable() was never created by any
-- migration in this repo's history (schema drift — it exists in the database this migration
-- originally ran against, but not via a tracked CREATE FUNCTION). A bare REVOKE on a
-- non-existent function errors, which blocks replaying this migration history from scratch
-- against an empty database (e.g. a fresh staging project). Guarding on to_regprocedure() with
-- the exact signature makes this a no-op when the function is absent and byte-for-byte
-- identical to the original statement when it is present — no behavior change anywhere this
-- statement previously succeeded.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end
$$;
