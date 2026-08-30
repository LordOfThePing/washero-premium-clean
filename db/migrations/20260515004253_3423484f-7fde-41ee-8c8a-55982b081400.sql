-- Safe admin profile RPC: returns the current user's active admin row, if any.
create or replace function public.get_my_admin_profile()
returns table (
  user_id uuid,
  email text,
  role text,
  active boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select au.user_id, au.email, au.role, au.active
  from public.admin_users au
  where au.user_id = auth.uid()
    and au.active = true
  limit 1;
$$;

revoke all on function public.get_my_admin_profile() from public;
grant execute on function public.get_my_admin_profile() to authenticated;

-- Ensure is_admin() is robust and usable from RLS policies.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_users
    where user_id = auth.uid()
      and active = true
  );
$$;

grant execute on function public.is_admin() to authenticated;
