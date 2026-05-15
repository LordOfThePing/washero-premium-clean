# Plan — Botmaker Auto-Booking + Calendar-First Booking UX

This is a large two-part upgrade. Below is what I'll build, in order, without breaking existing flows.

---

## PART A — Botmaker auto-booking

### A1. Shared booking helper
Create `supabase/functions/_shared/booking-core.ts` with `tryCreateBooking(admin, input, source)`:
- validates service (active, exists)
- matches `service_areas` (else `needs_review`)
- looks up `availability_slots` for `(date, start_time, active=true)`
- counts non-cancelled bookings vs `slot.capacity`
- duplicate check by `(phone, date, time)`
- upserts `customers` by phone
- inserts `bookings` with server-trusted price/duration
- returns `{ ok, booking?, reason?, status }`

### A2. Refactor `create-website-booking`
Use the shared helper internally. Same external contract. Add support for `vehicle_surcharge` + `selected_extras` (server-side calculated, allowlisted).

Allowlisted extras (id → price ARS):
- `encerado_rapido` 8000
- `detallado_interior_profundo` 9000
- `eliminacion_olores` 12000
- `barro_auto_muy_sucio` 7000
- `pelo_mascotas` 10000

Vehicle surcharges:
- `Auto` 0 · `SUV` 5000 · `Pick-up` 8000 · `Otro` 0 (forces `needs_review`)

Final `price = service.base_price + surcharge + sum(allowlisted extras)`. Unknown extra → 400 validation error. Extras stored readable in `notes`.

### A3. Update `botmaker-webhook`
After detecting summary + user confirmation:
1. Parse summary (existing parser) — normalize service, vehicle, payment, date, time.
2. Call `tryCreateBooking` with `source="botmaker"`.
3. If success → create `booking_request` with `status="converted"`, `linked_booking_id`, `booking_status="confirmed"` on the booking, link conversation.
4. If failure → create `booking_request` with `status="needs_review"` and `raw_payload.fallback_reason` (one of: `missing_fields`, `invalid_service`, `slot_unavailable`, `slot_full`, `duplicate`, `area_unclear`, `validation_error`).
5. Always insert `communication_logs` row.
6. Never lose the request.

### A4. New Edge Function `get-public-availability`
- Public (no auth required).
- Query params: `from=YYYY-MM-DD&to=YYYY-MM-DD`.
- Returns `[{ date, start_time, end_time, capacity, taken, remaining }]` for `active=true` slots, with non-cancelled booking counts.
- No customer/booking PII.

### A5. `/admin/mensajes` enhancements
Per conversation/request, add badges: `Auto-reservada`, `Requiere revisión`, `Convertida`, `Slot lleno`, `Datos incompletos`, `Test`.
Detail panel:
- If converted with booking → show booking summary card + links to `/admin/reservas` and `/admin/calendario`.
- If needs_review → show fallback reason + missing fields + manual approve button (existing flow).

### A6. `/admin/configuracion` Botmaker diagnostics
Add metrics:
- last auto-booking success at
- last fallback at
- count auto-created (Botmaker)
- count needing review (Botmaker)
- last fallback reason
Update copy.

---

## PART B — Calendar-first `/reservar`

### B1. New page structure
Single route `/reservar` rewritten:
- **State machine:** `calendar` → `time-picker` (sheet/modal) → `booking-form` (modal).
- Loads services + service areas + 60-day availability (via `get-public-availability`) on mount.

### B2. Calendar view
- Month grid: prev/next month nav, Spanish month/weekday labels.
- Each day cell: disabled if past or no slots; dot indicator if has remaining capacity; selected ring on click.
- Mobile-friendly: full-width grid.

### B3. Time picker (Sheet on mobile, Dialog on desktop)
Triggered by day click. Lists slots for that date as large buttons (HH:MM). Disabled if `remaining===0`.

### B4. Booking modal
Header: `Completá tu reserva` + `<weekday> <d> de <month> · HH:MM hs` + back-to-time button + close.

Sections:
1. **Servicio** — radio cards from `services`.
2. **Tamaño del vehículo** — Auto / SUV (+5000) / Pick-up (+8000).
3. **Extras opcionales** — 5 checkboxes (allowlisted).
4. **Dirección** — input.
5. **Barrio / Zona** — Select from active `service_areas` + `Otra zona`. Placeholder `Seleccioná tu barrio o zona`. No "auto-detect" copy.
6. **Datos de contacto** — nombre, teléfono, email.
7. **Notas adicionales** — textarea.
8. **Recordatorios WhatsApp** — checkbox (stored as note flag).
9. **Método de pago** — MercadoPago / Transferencia / Pagar después.
10. **Resumen de precio** — base + vehículo + extras + total (live).
11. **CTA** — `Pagar con MercadoPago →` or `Confirmar reserva →`.

Submits to `create-website-booking` with the new optional fields.

### B5. Server-side price safety
`create-website-booking` ignores client `front_total`, recomputes from trusted sources. Returns validation error on unknown extras.

---

## Technical notes

- No new tables. Extras stored readably in `notes`.
- `service_role` usage stays server-only.
- All Supabase calls use project `domslcbxgqbylmciqrxt`.
- Edge functions deployed via Lovable Cloud Supabase deploy (new ones registered in `supabase/config.toml`).
- Existing `/admin/*` pages, `mercadopago-webhook`, `mp-diagnostics`, `botmaker-diagnostics` not touched except where listed.

## Files to be created/changed

**Edge functions (Supabase):**
- new `supabase/functions/_shared/booking-core.ts`
- edit `supabase/functions/create-website-booking/index.ts`
- edit `supabase/functions/botmaker-webhook/index.ts`
- new `supabase/functions/get-public-availability/index.ts`
- edit `supabase/config.toml`

**Frontend:**
- rewrite `src/routes/_public.reservar.tsx`
- new `src/components/reservar/BookingCalendar.tsx`
- new `src/components/reservar/TimePicker.tsx`
- new `src/components/reservar/BookingFormModal.tsx`
- edit `src/routes/admin.mensajes.tsx` (badges + booking card)
- edit `src/routes/admin.configuracion.tsx` (Botmaker diagnostics metrics)

## Risks / warnings
- Botmaker auto-booking with MercadoPago: cannot send checkout URL through Botmaker without outbound API; auto-confirmed booking will be `payment_status=pending` and admin must follow up. Documented in admin UI copy.
- Extras live only in `notes` (no new table) — admin can read but not query.
- `get-public-availability` is unauthenticated by design (public site reads it). Returns no PII.

---

If you approve, I'll implement all of this. Reply "go" (or with edits) and I'll start.
