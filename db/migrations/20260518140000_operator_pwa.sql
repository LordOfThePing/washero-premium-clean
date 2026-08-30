-- Operator PWA: roles, booking assignment, operator read access

-- ---------------------------------------------------------------------------
-- Booking assignment fields
-- ---------------------------------------------------------------------------
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS assigned_operator_id uuid
    REFERENCES public.admin_users(id) ON DELETE SET NULL;

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS assigned_vehicle_label text;

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS operator_notes text;

CREATE INDEX IF NOT EXISTS bookings_assigned_operator_idx
  ON public.bookings (assigned_operator_id);

-- ---------------------------------------------------------------------------
-- Role helpers: admin = owner|admin only; operator = owner|admin|operator
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.admin_users
    WHERE user_id = auth.uid()
      AND active = true
      AND role IN ('owner', 'admin')
  );
$$;

CREATE OR REPLACE FUNCTION public.is_operator()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.admin_users
    WHERE user_id = auth.uid()
      AND active = true
      AND role IN ('owner', 'admin', 'operator')
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_operator() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_my_operator_profile()
RETURNS TABLE (
  staff_id uuid,
  user_id uuid,
  email text,
  role text,
  active boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT au.id, au.user_id, au.email, au.role, au.active
  FROM public.admin_users au
  WHERE au.user_id = auth.uid()
    AND au.active = true
    AND au.role IN ('owner', 'admin', 'operator')
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_my_operator_profile() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_operator_profile() TO authenticated;

-- ---------------------------------------------------------------------------
-- Operators: read operational bookings (no direct UPDATE)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS bookings_operator_select ON public.bookings;
CREATE POLICY bookings_operator_select ON public.bookings
  FOR SELECT TO authenticated
  USING (public.is_operator());

-- ---------------------------------------------------------------------------
-- Push notification prep (optional future use)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notification_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  endpoint text NOT NULL,
  p256dh text NOT NULL,
  auth text NOT NULL,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, endpoint)
);

ALTER TABLE public.notification_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notification_subscriptions_own ON public.notification_subscriptions;
CREATE POLICY notification_subscriptions_own ON public.notification_subscriptions
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid() AND public.is_operator());

DROP TRIGGER IF EXISTS notification_subscriptions_updated_at ON public.notification_subscriptions;
CREATE TRIGGER notification_subscriptions_updated_at
  BEFORE UPDATE ON public.notification_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
