-- Marketing attribution for offline QR campaigns and UTM tracking.
-- Keeps all columns nullable for backward compatibility with existing bookings.

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS marketing_source text,
  ADD COLUMN IF NOT EXISTS marketing_medium text,
  ADD COLUMN IF NOT EXISTS marketing_campaign text,
  ADD COLUMN IF NOT EXISTS marketing_content text,
  ADD COLUMN IF NOT EXISTS marketing_term text,
  ADD COLUMN IF NOT EXISTS qr_code_slug text,
  ADD COLUMN IF NOT EXISTS landing_url text,
  ADD COLUMN IF NOT EXISTS referrer_url text;

CREATE INDEX IF NOT EXISTS bookings_marketing_campaign_idx
  ON public.bookings (marketing_campaign);

CREATE INDEX IF NOT EXISTS bookings_qr_code_slug_idx
  ON public.bookings (qr_code_slug);
