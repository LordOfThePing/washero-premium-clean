-- generate_invoice_for_booking: creates an invoice from a booking (idempotent).
-- Admins can call via RPC (is_admin); service-role (MP webhook) bypasses RLS.

CREATE OR REPLACE FUNCTION public.generate_invoice_for_booking(_booking_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  is_caller_admin boolean := false;
  v_booking record;
  v_existing uuid;
  v_invoice_id uuid;
  v_number text;
  v_subtotal int;
  v_line_items jsonb;
BEGIN
  -- Allow service_role unconditionally; otherwise require admin
  IF current_setting('request.jwt.claims', true) IS NULL THEN
    is_caller_admin := true; -- service role context
  ELSE
    is_caller_admin := public.is_admin();
  END IF;
  IF NOT is_caller_admin THEN
    RAISE EXCEPTION 'permission_denied';
  END IF;

  SELECT * INTO v_booking FROM public.bookings WHERE id = _booking_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'booking_not_found'; END IF;

  SELECT id INTO v_existing FROM public.invoices WHERE booking_id = _booking_id LIMIT 1;
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;

  v_subtotal := COALESCE(v_booking.price, 0)
              - COALESCE(v_booking.vehicle_surcharge, 0)
              - COALESCE(v_booking.extras_total, 0);

  v_line_items := COALESCE(v_booking.price_breakdown, '{}'::jsonb) -> 'lines';
  IF v_line_items IS NULL OR jsonb_typeof(v_line_items) <> 'array' THEN
    v_line_items := jsonb_build_array(
      jsonb_build_object('label', COALESCE(v_booking.service_name,'Servicio'), 'amount', v_subtotal)
    );
    IF COALESCE(v_booking.vehicle_surcharge,0) > 0 THEN
      v_line_items := v_line_items || jsonb_build_array(
        jsonb_build_object('label', 'Recargo vehículo ('||COALESCE(v_booking.vehicle_type,'')||')', 'amount', v_booking.vehicle_surcharge)
      );
    END IF;
    IF COALESCE(v_booking.extras_total,0) > 0 THEN
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

GRANT EXECUTE ON FUNCTION public.generate_invoice_for_booking(uuid) TO authenticated, service_role;;
