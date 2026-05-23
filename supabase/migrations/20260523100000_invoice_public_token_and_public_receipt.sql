-- Public-safe receipt token infrastructure
-- Enables customer-facing /comprobante/{token} without exposing admin routes.

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS public_token text;

UPDATE public.invoices
SET public_token = replace(gen_random_uuid()::text, '-', '')
WHERE public_token IS NULL OR trim(public_token) = '';

ALTER TABLE public.invoices
  ALTER COLUMN public_token SET DEFAULT replace(gen_random_uuid()::text, '-', '');

CREATE UNIQUE INDEX IF NOT EXISTS invoices_public_token_key
  ON public.invoices (public_token)
  WHERE public_token IS NOT NULL;

CREATE OR REPLACE FUNCTION public.get_public_invoice_by_token(_public_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invoice public.invoices%ROWTYPE;
BEGIN
  IF _public_token IS NULL OR length(trim(_public_token)) = 0 THEN
    RETURN NULL;
  END IF;

  SELECT *
  INTO v_invoice
  FROM public.invoices
  WHERE public_token = trim(_public_token)
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'id', v_invoice.id,
    'invoice_number', v_invoice.invoice_number,
    'invoice_status', v_invoice.invoice_status,
    'status', v_invoice.status,
    'issued_at', v_invoice.issued_at,
    'customer_name', v_invoice.customer_name,
    'customer_phone', v_invoice.customer_phone,
    'customer_email', v_invoice.customer_email,
    'customer_address', v_invoice.customer_address,
    'service_name', v_invoice.service_name,
    'vehicle_type', v_invoice.vehicle_type,
    'scheduled_date', v_invoice.scheduled_date,
    'scheduled_time', v_invoice.scheduled_time,
    'subtotal', v_invoice.subtotal,
    'vehicle_surcharge', v_invoice.vehicle_surcharge,
    'extras_total', v_invoice.extras_total,
    'total', v_invoice.total,
    'payment_method', v_invoice.payment_method,
    'payment_status', v_invoice.payment_status,
    'line_items', v_invoice.line_items,
    'notes', v_invoice.notes,
    'public_token', v_invoice.public_token
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_public_invoice_by_token(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_public_invoice_by_token(text) FROM anon;
REVOKE ALL ON FUNCTION public.get_public_invoice_by_token(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_invoice_by_token(text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_public_invoice_by_token(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_invoice_by_token(text) TO service_role;
