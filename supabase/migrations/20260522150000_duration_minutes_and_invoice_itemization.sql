-- Duration model update:
-- - services.duration_minutes defaults + canonical values
-- - pricing_items.duration_minutes editable for vehicle/extras
-- - invoice line itemization from structured price_breakdown

-- Services: keep NOT NULL + default and align canonical durations.
ALTER TABLE public.services
  ALTER COLUMN duration_minutes SET DEFAULT 60;

UPDATE public.services
SET duration_minutes = 60
WHERE duration_minutes IS NULL OR duration_minutes <= 0;

ALTER TABLE public.services
  ALTER COLUMN duration_minutes SET NOT NULL;

UPDATE public.services
SET duration_minutes = 40
WHERE lower(name) LIKE '%basico%' OR lower(name) LIKE '%básico%';

UPDATE public.services
SET duration_minutes = 60
WHERE lower(name) LIKE '%completo%';

-- Pricing items: add duration_minutes for vehicle surcharges and extras.
ALTER TABLE public.pricing_items
  ADD COLUMN IF NOT EXISTS duration_minutes integer;

UPDATE public.pricing_items
SET duration_minutes = 0
WHERE duration_minutes IS NULL OR duration_minutes < 0;

ALTER TABLE public.pricing_items
  ALTER COLUMN duration_minutes SET DEFAULT 0;

ALTER TABLE public.pricing_items
  ALTER COLUMN duration_minutes SET NOT NULL;

-- Vehicle duration minutes
UPDATE public.pricing_items
SET duration_minutes = 0
WHERE type = 'vehicle_surcharge'
  AND (
    lower(code) = 'auto'
    OR lower(name) LIKE '%auto%'
  );

UPDATE public.pricing_items
SET duration_minutes = 10
WHERE type = 'vehicle_surcharge'
  AND (
    lower(code) LIKE 'suv%'
    OR lower(name) LIKE '%suv%'
    OR lower(name) LIKE '%crossover%'
  );

UPDATE public.pricing_items
SET duration_minutes = 10
WHERE type = 'vehicle_surcharge'
  AND (
    lower(code) IN ('pickup', 'pick_up', 'pick-up')
    OR lower(name) LIKE '%pick%'
    OR lower(name) LIKE '%camioneta%'
    OR lower(name) LIKE '%van%'
  );

-- Extras duration minutes
UPDATE public.pricing_items
SET duration_minutes = 10
WHERE type = 'extra'
  AND (
    lower(code) LIKE '%encerado%'
    OR lower(code) LIKE '%encer%'
    OR lower(name) LIKE '%encerado%'
    OR lower(name) LIKE '%encer%'
  );

UPDATE public.pricing_items
SET duration_minutes = 20
WHERE type = 'extra'
  AND (
    lower(code) LIKE '%detallado_interior_profundo%'
    OR (
      lower(name) LIKE '%detallado%'
      AND lower(name) LIKE '%interior%'
      AND lower(name) LIKE '%profundo%'
    )
  );

UPDATE public.pricing_items
SET duration_minutes = 15
WHERE type = 'extra'
  AND (
    lower(code) LIKE '%eliminacion_olores%'
    OR lower(code) LIKE '%eliminacion%'
    OR lower(name) LIKE '%olor%'
  );

UPDATE public.pricing_items
SET duration_minutes = 15
WHERE type = 'extra'
  AND (
    lower(code) LIKE '%barro%'
    OR lower(name) LIKE '%barro%'
    OR lower(name) LIKE '%muy sucio%'
  );

UPDATE public.pricing_items
SET duration_minutes = 20
WHERE type = 'extra'
  AND (
    lower(code) LIKE '%pelo_mascotas%'
    OR (
      lower(name) LIKE '%pelo%'
      AND lower(name) LIKE '%mascot%'
    )
  );

-- Rebuild invoice generation to emit charged line items only.
CREATE OR REPLACE FUNCTION public.generate_invoice_for_booking(_booking_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking record;
  v_existing uuid;
  v_invoice_id uuid;
  v_number text;
  v_subtotal int;
  v_line_items jsonb := '[]'::jsonb;
  v_breakdown jsonb := '{}'::jsonb;
  v_line jsonb;
  v_extra jsonb;
  v_label text;
  v_amount int;
BEGIN
  IF NOT (
    coalesce(auth.role(), '') = 'service_role'
    OR public.is_admin()
  ) THEN
    RAISE EXCEPTION 'permission_denied';
  END IF;

  SELECT * INTO v_booking FROM public.bookings WHERE id = _booking_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'booking_not_found';
  END IF;

  SELECT id INTO v_existing FROM public.invoices WHERE booking_id = _booking_id LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  v_subtotal := COALESCE(v_booking.price, 0)
              - COALESCE(v_booking.vehicle_surcharge, 0)
              - COALESCE(v_booking.extras_total, 0);

  v_breakdown := COALESCE(v_booking.price_breakdown, '{}'::jsonb);

  -- Preferred shape: service + vehicle + extras with explicit amounts.
  IF jsonb_typeof(v_breakdown->'service') = 'object' THEN
    v_label := COALESCE(v_breakdown->'service'->>'name', v_booking.service_name, 'Servicio');
    v_amount := COALESCE((v_breakdown->'service'->>'amount')::int, 0);
    IF v_amount > 0 THEN
      v_line_items := v_line_items || jsonb_build_array(
        jsonb_build_object('label', v_label, 'amount', v_amount)
      );
    END IF;
  END IF;

  IF jsonb_typeof(v_breakdown->'vehicle') = 'object' THEN
    v_label := COALESCE(v_breakdown->'vehicle'->>'name', 'Recargo vehículo (' || COALESCE(v_booking.vehicle_type,'') || ')');
    v_amount := COALESCE((v_breakdown->'vehicle'->>'amount')::int, 0);
    IF v_amount > 0 THEN
      v_line_items := v_line_items || jsonb_build_array(
        jsonb_build_object('label', v_label, 'amount', v_amount)
      );
    END IF;
  END IF;

  IF jsonb_typeof(v_breakdown->'extras') = 'array' THEN
    FOR v_extra IN SELECT value FROM jsonb_array_elements(v_breakdown->'extras') LOOP
      v_label := COALESCE(v_extra->>'name', v_extra->>'code', 'Extra');
      v_amount := COALESCE((v_extra->>'amount')::int, 0);
      IF v_amount > 0 THEN
        v_line_items := v_line_items || jsonb_build_array(
          jsonb_build_object('label', v_label, 'amount', v_amount)
        );
      END IF;
    END LOOP;
  END IF;

  -- Legacy shape: keep only positive amounts from old "lines".
  IF jsonb_array_length(v_line_items) = 0 AND jsonb_typeof(v_breakdown->'lines') = 'array' THEN
    FOR v_line IN SELECT value FROM jsonb_array_elements(v_breakdown->'lines') LOOP
      v_label := COALESCE(v_line->>'label', '');
      v_amount := COALESCE((v_line->>'amount')::int, 0);
      IF v_label <> '' AND v_amount > 0 THEN
        v_line_items := v_line_items || jsonb_build_array(
          jsonb_build_object('label', v_label, 'amount', v_amount)
        );
      END IF;
    END LOOP;
  END IF;

  -- Last fallback for old bookings without structured details.
  IF jsonb_array_length(v_line_items) = 0 THEN
    v_line_items := jsonb_build_array(
      jsonb_build_object('label', COALESCE(v_booking.service_name,'Servicio'), 'amount', v_subtotal)
    );
    IF COALESCE(v_booking.vehicle_surcharge, 0) > 0 THEN
      v_line_items := v_line_items || jsonb_build_array(
        jsonb_build_object('label', 'Recargo vehículo (' || COALESCE(v_booking.vehicle_type,'') || ')', 'amount', v_booking.vehicle_surcharge)
      );
    END IF;
    IF COALESCE(v_booking.extras_total, 0) > 0 THEN
      v_line_items := v_line_items || jsonb_build_array(
        jsonb_build_object('label', 'Extras', 'amount', v_booking.extras_total)
      );
    END IF;
  END IF;

  v_number := public.next_invoice_number();

  INSERT INTO public.invoices (
    booking_id, invoice_number, status, invoice_status, issued_at,
    customer_name, customer_phone, customer_email, customer_address,
    service_name, vehicle_type, scheduled_date, scheduled_time,
    subtotal, vehicle_surcharge, extras_total, total,
    payment_method, payment_status, line_items
  ) VALUES (
    _booking_id, v_number, 'issued', 'issued', now(),
    v_booking.customer_name, v_booking.customer_phone, v_booking.customer_email,
    COALESCE(v_booking.formatted_address, v_booking.address),
    v_booking.service_name, v_booking.vehicle_type, v_booking.scheduled_date, v_booking.scheduled_time,
    v_subtotal, COALESCE(v_booking.vehicle_surcharge,0), COALESCE(v_booking.extras_total,0), COALESCE(v_booking.price,0),
    v_booking.payment_method, v_booking.payment_status, v_line_items
  ) RETURNING id INTO v_invoice_id;

  RETURN v_invoice_id;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_invoice_for_booking(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.generate_invoice_for_booking(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.generate_invoice_for_booking(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_invoice_for_booking(uuid) TO service_role;
