-- Payment receipts (Transferencia comprobantes via WhatsApp / admin)

CREATE TABLE IF NOT EXISTS public.payment_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  customer_phone text,
  source text NOT NULL DEFAULT 'whatsapp'
    CHECK (source IN ('whatsapp', 'admin_upload', 'manual')),
  botmaker_message_id uuid NULL,
  media_url text NULL,
  storage_bucket text NOT NULL DEFAULT 'payment-receipts',
  storage_path text,
  mime_type text,
  file_name text,
  file_size integer,
  status text NOT NULL DEFAULT 'pending_review'
    CHECK (status IN ('pending_review', 'approved', 'rejected', 'unresolved')),
  reviewed_by uuid NULL REFERENCES public.admin_users(id) ON DELETE SET NULL,
  reviewed_at timestamptz NULL,
  notes text NULL,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payment_receipts_booking_id_idx
  ON public.payment_receipts (booking_id);
CREATE INDEX IF NOT EXISTS payment_receipts_customer_phone_idx
  ON public.payment_receipts (customer_phone);
CREATE INDEX IF NOT EXISTS payment_receipts_status_idx
  ON public.payment_receipts (status);
CREATE INDEX IF NOT EXISTS payment_receipts_created_at_idx
  ON public.payment_receipts (created_at DESC);

DROP TRIGGER IF EXISTS payment_receipts_set_updated_at ON public.payment_receipts;
CREATE TRIGGER payment_receipts_set_updated_at
  BEFORE UPDATE ON public.payment_receipts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.payment_receipts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "payment_receipts admin all" ON public.payment_receipts;
CREATE POLICY "payment_receipts admin all" ON public.payment_receipts
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Private bucket for receipt files (not public)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'payment-receipts',
  'payment-receipts',
  false,
  10485760,
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "payment_receipts storage admin read" ON storage.objects;
CREATE POLICY "payment_receipts storage admin read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'payment-receipts' AND public.is_admin());
