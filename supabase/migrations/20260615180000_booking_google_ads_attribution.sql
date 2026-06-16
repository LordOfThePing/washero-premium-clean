-- Google Ads click identifiers for offline conversion matching and reporting.
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS gclid text,
  ADD COLUMN IF NOT EXISTS gbraid text,
  ADD COLUMN IF NOT EXISTS wbraid text;

CREATE INDEX IF NOT EXISTS bookings_gclid_idx ON public.bookings (gclid)
  WHERE gclid IS NOT NULL;

COMMENT ON COLUMN public.bookings.gclid IS 'Google Ads click ID (gclid URL parameter).';
COMMENT ON COLUMN public.bookings.gbraid IS 'Google Ads iOS app-to-web measurement ID (gbraid).';
COMMENT ON COLUMN public.bookings.wbraid IS 'Google Ads web-to-app measurement ID (wbraid).';
