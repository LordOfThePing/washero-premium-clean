-- Tighten operator booking visibility:
-- - owner/admin can see all bookings in operator app
-- - operator role can only see bookings assigned to them

CREATE OR REPLACE FUNCTION public.my_staff_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id
  FROM public.admin_users
  WHERE user_id = auth.uid()
    AND active = true
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.my_staff_id() TO authenticated;

DROP POLICY IF EXISTS bookings_operator_select ON public.bookings;
CREATE POLICY bookings_operator_select ON public.bookings
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR assigned_operator_id = public.my_staff_id()
  );
