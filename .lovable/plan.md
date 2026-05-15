# Production Upgrade Plan — Maps + Pricing + Invoices + Demand Map

This is a large, multi-area upgrade. I'll execute it in 4 phases. Before starting I need 2 confirmations from you because they have material consequences and need user-side action.

---

## Required from you before I start

1. **Google Maps API keys** (two separate keys recommended):
   - `VITE_GOOGLE_MAPS_PUBLIC_KEY` — browser key, restricted by HTTP referrer in Google Cloud (your `*.lovable.app` domain + your custom domain). Needs: Maps JavaScript API + Places API (New).
   - `GOOGLE_MAPS_SERVER_KEY` — server-side key, restricted by IP or unrestricted. Needs: Places API + Geocoding API.
   
   I'll prompt you with the secrets tool once you approve this plan. **Note**: alternatively, this project already has a Lovable-managed Google Maps connector available — I can use that gateway for server-side calls (no key needed) and only ask you for the browser key. Tell me which you prefer.

2. **"Strict coverage" confirmation**: Part A removes the "Otra zona" option from the public booking form and hard-blocks bookings outside the 7 zones. Confirm this is what you want for launch (Botmaker still degrades gracefully to `needs_review`).

---

## Phase 1 — Database migration (single migration)

New tables:
- `coverage_zones` (name, aliases[], center_lat/lng, radius_km, polygon_geojson, display_order, active) — seed 7 zones
- `pricing_items` (type: vehicle_surcharge|extra, code, name, description, amount, active, display_order, unique(type,code)) — seed 3 surcharges + 5 extras

Column additions:
- `bookings`: place_id, formatted_address, address_lat, address_lng, coverage_zone_id, coverage_zone_name, location_validation_status, location_validation_payload, vehicle_surcharge, selected_extras (jsonb), extras_total, price_breakdown (jsonb)
- `customers`: place_id, formatted_address, address_lat, address_lng, coverage_zone_id, coverage_zone_name
- `invoices`: customer_name, customer_phone, customer_email, customer_address, service_name, vehicle_type, scheduled_date, scheduled_time, subtotal, vehicle_surcharge, extras_total, total, payment_method, payment_status, invoice_status, line_items (jsonb)

Helper: `next_invoice_number()` SQL function returning `WASH-YYYY-NNNNNN`.

RLS: public SELECT on active rows of new public tables; admin full CRUD via `is_admin()`.

## Phase 2 — Part A: Maps + Coverage

- New edge function `validate-address-location` — uses `GOOGLE_MAPS_SERVER_KEY` (or Lovable connector gateway). Returns `inside_coverage`, zone, lat/lng, formatted_address. Match order: polygon → alias → radius.
- Shared helper `_shared/coverage.ts` reused by website + botmaker code paths.
- `_reservar` modal: replace address `<Input>` with Places Autocomplete component (loaded async with callback). Block submit until a suggestion is chosen + validated.
- `create-website-booking`: accept place_id/lat/lng + re-validate server-side; reject with `outside_coverage` status.
- `botmaker-webhook` / `_shared/botmaker-booking.ts`: validate parsed neighborhood against `coverage_zones.aliases`; mark `needs_review` with `outside_coverage_or_unverified` when no match.

## Phase 3 — Part B: Editable pricing

- Update `_shared/booking-core.ts`: load surcharge + extras from `pricing_items` instead of constants. Persist `vehicle_surcharge`, `extras_total`, `selected_extras`, `price_breakdown` on booking insert.
- Update `/reservar` to fetch active services + pricing_items and render dynamic vehicle cards + extras.
- Rebuild `/admin/precios` with 3 sections (Servicios | Recargos | Extras) — full CRUD using existing supabase client + admin RLS.

## Phase 4 — Part C: Invoices + Part D: Demand Map

Invoices:
- Helper `generateInvoiceForBooking(bookingId)` (server function) — idempotent (one invoice per booking), uses `next_invoice_number()`, copies `price_breakdown` into `line_items`.
- Hooked into:
  - `/admin/reservas` "marcar como pagada" action
  - `/admin/calendario` shared booking detail
  - `mercadopago-webhook` on approved
- Rebuild `/admin/facturas`: list + filters (date range, status, search) + metrics + actions.
- New route `/admin/facturas/$invoiceId`: print-friendly invoice with `window.print()`.

Demand Map (`/admin/mapa-demanda`):
- Filter bar: Today / Week / Month / 30d / Custom + status + service + payment + source.
- Metrics row: total / completed / pending / revenue / avg ticket / top zone / empty zones.
- Map: Google Maps JS (using browser key) — polygons or circles per zone, color intensity by count, booking markers. Fallback to charts/table when key missing.
- Side panel: per-zone breakdown; click filters booking list below.

Coverage zones admin editor added to `/admin/app-config` (active/aliases/center/radius/polygon/order).

## Files / functions touched (summary)

**Migrations**: 1 new (~250 lines).
**Edge functions**: new `validate-address-location/`; updated `create-website-booking/`, `botmaker-webhook/`, `mercadopago-webhook/`, `_shared/booking-core.ts`, new `_shared/coverage.ts`, new `_shared/invoices.ts`.
**Frontend**: `src/routes/_public.reservar.tsx`, `src/routes/admin.precios.tsx`, `src/routes/admin.facturas.tsx`, `src/routes/admin.facturas.$invoiceId.tsx` (new), `src/routes/admin.mapa-demanda.tsx`, `src/routes/admin.app-config.tsx`, `src/routes/admin.reservas.tsx`, `src/routes/admin.calendario.tsx`. New `src/components/PlacesAutocomplete.tsx`, `src/components/InvoicePrintable.tsx`, `src/components/DemandMap.tsx`.

## Risks / things I won't break

- Existing bookings keep their stored `price` and old fields (new columns are additive, defaults safe).
- Botmaker stays functional even when address can't be matched (falls into `needs_review`).
- MP webhook keeps existing payment recording; invoice generation is added after the existing logic.
- No Lovable Cloud, no other Supabase ref — only `domslcbxgqbylmciqrxt`.

---

**Reply with:**
1. Maps key approach: **own keys** (I'll request both via secrets) **or** **Lovable Maps connector for server + your own browser key**.
2. **Confirm strict coverage** (block "Otra zona" on website).
3. Anything you want to defer (e.g. skip polygon editor for now).

Once you confirm, I'll execute Phases 1→4 in order.