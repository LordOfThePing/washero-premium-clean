-- Subscription plans MVP (admin-only)

-- ---------------------------------------------------------------------------
-- subscription_plans
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.subscription_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  monthly_price integer NOT NULL DEFAULT 0,
  washes_per_month integer NOT NULL DEFAULT 1,
  active boolean NOT NULL DEFAULT true,
  allowed_service_ids uuid[] NOT NULL DEFAULT '{}',
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT subscription_plans_monthly_price_nonneg CHECK (monthly_price >= 0),
  CONSTRAINT subscription_plans_washes_per_month_positive CHECK (washes_per_month > 0)
);

CREATE INDEX IF NOT EXISTS subscription_plans_active_idx ON public.subscription_plans (active);
CREATE INDEX IF NOT EXISTS subscription_plans_display_order_idx ON public.subscription_plans (display_order);

-- ---------------------------------------------------------------------------
-- customer_subscriptions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.customer_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES public.subscription_plans(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'active',
  start_date date NOT NULL DEFAULT CURRENT_DATE,
  current_period_start date NOT NULL DEFAULT CURRENT_DATE,
  current_period_end date NOT NULL,
  billing_day integer,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_subscriptions_status_check
    CHECK (status IN ('active', 'paused', 'cancelled')),
  CONSTRAINT customer_subscriptions_billing_day_check
    CHECK (billing_day IS NULL OR (billing_day >= 1 AND billing_day <= 28))
);

CREATE INDEX IF NOT EXISTS customer_subscriptions_customer_idx ON public.customer_subscriptions (customer_id);
CREATE INDEX IF NOT EXISTS customer_subscriptions_plan_idx ON public.customer_subscriptions (plan_id);
CREATE INDEX IF NOT EXISTS customer_subscriptions_status_idx ON public.customer_subscriptions (status);

-- ---------------------------------------------------------------------------
-- subscription_usages
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.subscription_usages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_subscription_id uuid NOT NULL REFERENCES public.customer_subscriptions(id) ON DELETE CASCADE,
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  period_start date NOT NULL,
  period_end date NOT NULL,
  used_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT subscription_usages_booking_id_unique UNIQUE (booking_id)
);

CREATE INDEX IF NOT EXISTS subscription_usages_subscription_idx
  ON public.subscription_usages (customer_subscription_id);
CREATE INDEX IF NOT EXISTS subscription_usages_period_idx
  ON public.subscription_usages (customer_subscription_id, period_start, period_end);

-- ---------------------------------------------------------------------------
-- bookings: subscription linkage
-- ---------------------------------------------------------------------------
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS customer_subscription_id uuid
    REFERENCES public.customer_subscriptions(id) ON DELETE SET NULL;

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS subscription_usage_id uuid
    REFERENCES public.subscription_usages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS bookings_customer_subscription_idx
  ON public.bookings (customer_subscription_id);

-- Extend booking_source constraint
ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_booking_source_check;
ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_booking_source_check
  CHECK (booking_source IN (
    'website', 'admin', 'botmaker', 'manual', 'subscription', 'admin_subscription'
  ));

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS subscription_plans_updated_at ON public.subscription_plans;
CREATE TRIGGER subscription_plans_updated_at
  BEFORE UPDATE ON public.subscription_plans
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS customer_subscriptions_updated_at ON public.customer_subscriptions;
CREATE TRIGGER customer_subscriptions_updated_at
  BEFORE UPDATE ON public.customer_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- RLS (admin only)
-- ---------------------------------------------------------------------------
ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_usages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS subscription_plans_admin_all ON public.subscription_plans;
CREATE POLICY subscription_plans_admin_all ON public.subscription_plans
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS customer_subscriptions_admin_all ON public.customer_subscriptions;
CREATE POLICY customer_subscriptions_admin_all ON public.customer_subscriptions
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS subscription_usages_admin_all ON public.subscription_usages;
CREATE POLICY subscription_usages_admin_all ON public.subscription_usages
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ---------------------------------------------------------------------------
-- Seed plans
-- ---------------------------------------------------------------------------
INSERT INTO public.subscription_plans (name, description, monthly_price, washes_per_month, active, display_order)
SELECT v.name, v.description, v.monthly_price, v.washes_per_month, v.active, v.display_order
FROM (VALUES
  ('Plan Básico'::text, '2 lavados por mes'::text, 60000, 2, true, 1),
  ('Plan Plus', '4 lavados por mes', 110000, 4, true, 2),
  ('Plan Premium', '8 lavados por mes', 200000, 8, true, 3)
) AS v(name, description, monthly_price, washes_per_month, active, display_order)
WHERE NOT EXISTS (
  SELECT 1 FROM public.subscription_plans sp WHERE sp.name = v.name
);
