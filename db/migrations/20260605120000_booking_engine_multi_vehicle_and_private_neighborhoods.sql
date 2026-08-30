-- Booking engine schema prep:
-- - private_neighborhoods for gated-community address normalization
-- - bookings columns for multi-vehicle + private address metadata
-- - booking_units for per-vehicle line items (second unit discount support)

-- ============================================================
-- private_neighborhoods
-- ============================================================
CREATE TABLE IF NOT EXISTS public.private_neighborhoods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  aliases text[] NOT NULL DEFAULT '{}',
  active boolean NOT NULL DEFAULT true,
  coverage_zone_id uuid REFERENCES public.coverage_zones(id) ON DELETE SET NULL,
  coverage_zone_name text,
  canonical_address text NOT NULL,
  formatted_address text NOT NULL,
  place_id text,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  city text,
  province text,
  access_notes text,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.private_neighborhoods ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "private_neighborhoods public read" ON public.private_neighborhoods;
CREATE POLICY "private_neighborhoods public read" ON public.private_neighborhoods
  FOR SELECT TO anon, authenticated
  USING (active = true);

DROP POLICY IF EXISTS "private_neighborhoods admin all" ON public.private_neighborhoods;
CREATE POLICY "private_neighborhoods admin all" ON public.private_neighborhoods
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP TRIGGER IF EXISTS private_neighborhoods_updated_at ON public.private_neighborhoods;
CREATE TRIGGER private_neighborhoods_updated_at
  BEFORE UPDATE ON public.private_neighborhoods
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS private_neighborhoods_active_idx
  ON public.private_neighborhoods (active);

CREATE INDEX IF NOT EXISTS private_neighborhoods_display_order_idx
  ON public.private_neighborhoods (display_order);

CREATE INDEX IF NOT EXISTS private_neighborhoods_coverage_zone_idx
  ON public.private_neighborhoods (coverage_zone_id);

-- ============================================================
-- bookings: address type, private neighborhood, multi-vehicle pricing
-- ============================================================
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS address_type text DEFAULT 'street',
  ADD COLUMN IF NOT EXISTS private_neighborhood_id uuid
    REFERENCES public.private_neighborhoods(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS private_neighborhood_name text,
  ADD COLUMN IF NOT EXISTS private_lot text,
  ADD COLUMN IF NOT EXISTS private_extra_details text,
  ADD COLUMN IF NOT EXISTS vehicle_count integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS subtotal_before_discounts integer,
  ADD COLUMN IF NOT EXISTS discount_total integer DEFAULT 0;

UPDATE public.bookings
SET address_type = 'street'
WHERE address_type IS NULL;

UPDATE public.bookings
SET vehicle_count = 1
WHERE vehicle_count IS NULL OR vehicle_count < 1;

UPDATE public.bookings
SET subtotal_before_discounts = price
WHERE subtotal_before_discounts IS NULL;

UPDATE public.bookings
SET discount_total = 0
WHERE discount_total IS NULL;

ALTER TABLE public.bookings
  ALTER COLUMN address_type SET DEFAULT 'street',
  ALTER COLUMN address_type SET NOT NULL,
  ALTER COLUMN vehicle_count SET DEFAULT 1,
  ALTER COLUMN vehicle_count SET NOT NULL,
  ALTER COLUMN discount_total SET DEFAULT 0,
  ALTER COLUMN discount_total SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'bookings_address_type_check'
      AND conrelid = 'public.bookings'::regclass
  ) THEN
    ALTER TABLE public.bookings
      ADD CONSTRAINT bookings_address_type_check
      CHECK (address_type IN ('street', 'private_neighborhood'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS bookings_address_type_idx
  ON public.bookings (address_type);

CREATE INDEX IF NOT EXISTS bookings_private_neighborhood_idx
  ON public.bookings (private_neighborhood_id);

-- ============================================================
-- booking_units
-- ============================================================
CREATE TABLE IF NOT EXISTS public.booking_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  unit_index integer NOT NULL,
  vehicle_type text NOT NULL,
  service_id uuid REFERENCES public.services(id) ON DELETE SET NULL,
  service_name text NOT NULL,
  selected_extras jsonb NOT NULL DEFAULT '[]'::jsonb,
  service_price integer NOT NULL DEFAULT 0,
  vehicle_surcharge integer NOT NULL DEFAULT 0,
  extras_total integer NOT NULL DEFAULT 0,
  discount_rate numeric NOT NULL DEFAULT 0,
  discount_amount integer NOT NULL DEFAULT 0,
  total_price integer NOT NULL DEFAULT 0,
  duration_minutes integer NOT NULL DEFAULT 0,
  price_breakdown jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (booking_id, unit_index)
);

ALTER TABLE public.booking_units ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "booking_units admin all" ON public.booking_units;
CREATE POLICY "booking_units admin all" ON public.booking_units
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE INDEX IF NOT EXISTS booking_units_booking_id_idx
  ON public.booking_units (booking_id);
