
-- ============================================================
-- coverage_zones
-- ============================================================
CREATE TABLE IF NOT EXISTS public.coverage_zones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  active boolean NOT NULL DEFAULT true,
  aliases text[] NOT NULL DEFAULT '{}',
  center_lat double precision,
  center_lng double precision,
  radius_km numeric NOT NULL DEFAULT 5,
  polygon_geojson jsonb,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.coverage_zones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "coverage_zones public read" ON public.coverage_zones;
CREATE POLICY "coverage_zones public read" ON public.coverage_zones
  FOR SELECT TO anon, authenticated USING (active = true);

DROP POLICY IF EXISTS "coverage_zones admin all" ON public.coverage_zones;
CREATE POLICY "coverage_zones admin all" ON public.coverage_zones
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP TRIGGER IF EXISTS coverage_zones_updated_at ON public.coverage_zones;
CREATE TRIGGER coverage_zones_updated_at
  BEFORE UPDATE ON public.coverage_zones
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.coverage_zones (name, aliases, display_order) VALUES
  ('Maschwitz', ARRAY['Ingeniero Maschwitz','Maschwitz','Ing. Maschwitz'], 1),
  ('Escobar', ARRAY['Belén de Escobar','Belen de Escobar','Escobar'], 2),
  ('Benavídez', ARRAY['Benavidez','Benavídez'], 3),
  ('Garín', ARRAY['Garin','Garín'], 4),
  ('Dique Luján', ARRAY['Dique Lujan','Dique Luján'], 5),
  ('Tigre', ARRAY['Tigre'], 6),
  ('Nordelta', ARRAY['Nordelta'], 7)
ON CONFLICT (name) DO NOTHING;

-- ============================================================
-- pricing_items
-- ============================================================
CREATE TABLE IF NOT EXISTS public.pricing_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL CHECK (type IN ('vehicle_surcharge','extra')),
  code text NOT NULL,
  name text NOT NULL,
  description text,
  amount integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (type, code)
);

ALTER TABLE public.pricing_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pricing_items public read" ON public.pricing_items;
CREATE POLICY "pricing_items public read" ON public.pricing_items
  FOR SELECT TO anon, authenticated USING (active = true);

DROP POLICY IF EXISTS "pricing_items admin all" ON public.pricing_items;
CREATE POLICY "pricing_items admin all" ON public.pricing_items
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP TRIGGER IF EXISTS pricing_items_updated_at ON public.pricing_items;
CREATE TRIGGER pricing_items_updated_at
  BEFORE UPDATE ON public.pricing_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.pricing_items (type, code, name, amount, display_order) VALUES
  ('vehicle_surcharge','auto','Auto chico',0,1),
  ('vehicle_surcharge','suv','SUV / Crossover',5000,2),
  ('vehicle_surcharge','pickup','Pick Up / Van',8000,3),
  ('extra','encerado_rapido','Encerado rápido',8000,1),
  ('extra','detallado_interior_profundo','Detallado interior profundo',9000,2),
  ('extra','eliminacion_olores','Eliminación de olores',12000,3),
  ('extra','barro_auto_muy_sucio','Barro / Auto muy sucio',7000,4),
  ('extra','pelo_mascotas','Pelo de mascotas',10000,5)
ON CONFLICT (type, code) DO NOTHING;

-- ============================================================
-- bookings columns
-- ============================================================
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS place_id text,
  ADD COLUMN IF NOT EXISTS formatted_address text,
  ADD COLUMN IF NOT EXISTS address_lat double precision,
  ADD COLUMN IF NOT EXISTS address_lng double precision,
  ADD COLUMN IF NOT EXISTS coverage_zone_id uuid REFERENCES public.coverage_zones(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS coverage_zone_name text,
  ADD COLUMN IF NOT EXISTS location_validation_status text DEFAULT 'unverified',
  ADD COLUMN IF NOT EXISTS location_validation_payload jsonb,
  ADD COLUMN IF NOT EXISTS vehicle_surcharge integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS selected_extras jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS extras_total integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS price_breakdown jsonb NOT NULL DEFAULT '{}'::jsonb;

-- ============================================================
-- customers columns
-- ============================================================
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS place_id text,
  ADD COLUMN IF NOT EXISTS formatted_address text,
  ADD COLUMN IF NOT EXISTS address_lat double precision,
  ADD COLUMN IF NOT EXISTS address_lng double precision,
  ADD COLUMN IF NOT EXISTS coverage_zone_id uuid REFERENCES public.coverage_zones(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS coverage_zone_name text;

-- ============================================================
-- invoices columns + helper
-- ============================================================
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS customer_name text,
  ADD COLUMN IF NOT EXISTS customer_phone text,
  ADD COLUMN IF NOT EXISTS customer_email text,
  ADD COLUMN IF NOT EXISTS customer_address text,
  ADD COLUMN IF NOT EXISTS service_name text,
  ADD COLUMN IF NOT EXISTS vehicle_type text,
  ADD COLUMN IF NOT EXISTS scheduled_date date,
  ADD COLUMN IF NOT EXISTS scheduled_time time,
  ADD COLUMN IF NOT EXISTS subtotal integer,
  ADD COLUMN IF NOT EXISTS vehicle_surcharge integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS extras_total integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total integer,
  ADD COLUMN IF NOT EXISTS payment_method text,
  ADD COLUMN IF NOT EXISTS payment_status text,
  ADD COLUMN IF NOT EXISTS invoice_status text NOT NULL DEFAULT 'issued',
  ADD COLUMN IF NOT EXISTS line_items jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS invoices_invoice_number_key ON public.invoices (invoice_number) WHERE invoice_number IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS invoices_one_per_booking ON public.invoices (booking_id) WHERE booking_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.next_invoice_number()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  yr text := to_char(now(), 'YYYY');
  cnt integer;
BEGIN
  SELECT COUNT(*) + 1 INTO cnt
  FROM public.invoices
  WHERE invoice_number LIKE 'WASH-' || yr || '-%';
  RETURN 'WASH-' || yr || '-' || lpad(cnt::text, 6, '0');
END;
$$;
