-- Unify coverage source of truth on coverage_zones.
-- Admin historically wrote service_areas while booking validation read coverage_zones.

ALTER TABLE public.coverage_zones
  ADD COLUMN IF NOT EXISTS coverage_notes text;

-- Ensure public booking can read only active zones (idempotent).
DROP POLICY IF EXISTS "coverage_zones public read" ON public.coverage_zones;
CREATE POLICY "coverage_zones public read" ON public.coverage_zones
  FOR SELECT TO anon, authenticated
  USING (active = true);

DROP POLICY IF EXISTS "coverage_zones admin all" ON public.coverage_zones;
CREATE POLICY "coverage_zones admin all" ON public.coverage_zones
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Backfill any admin-managed service_areas that are missing from coverage_zones
-- (e.g. Maquinista Savio added only in the legacy table).
INSERT INTO public.coverage_zones (name, active, aliases, display_order, coverage_notes)
SELECT
  sa.name,
  sa.active,
  ARRAY[]::text[],
  100 + (ROW_NUMBER() OVER (ORDER BY sa.name))::integer,
  sa.coverage_notes
FROM public.service_areas sa
WHERE NOT EXISTS (
  SELECT 1
  FROM public.coverage_zones cz
  WHERE lower(trim(cz.name)) = lower(trim(sa.name))
);

-- Align active flag + notes for names present in both tables.
UPDATE public.coverage_zones cz
SET
  active = sa.active,
  coverage_notes = COALESCE(cz.coverage_notes, sa.coverage_notes),
  updated_at = now()
FROM public.service_areas sa
WHERE lower(trim(cz.name)) = lower(trim(sa.name));
