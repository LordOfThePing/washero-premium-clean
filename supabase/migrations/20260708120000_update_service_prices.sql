-- Update base prices for existing services to current confirmed business pricing.
-- Matches by name only; does not touch active/status or any other column.
UPDATE public.services
SET base_price = 35000
WHERE name = 'Lavado Básico';

UPDATE public.services
SET base_price = 42000
WHERE name = 'Lavado Completo';
