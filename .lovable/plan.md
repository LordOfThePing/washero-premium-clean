# Washero Admin Upgrade — Implementation Plan

Large multi-part scope. I'll execute in this order, with one DB migration upfront covering all new tables.

## Part A — Database migration (single migration)

New tables (all RLS-enabled, admin-only via `is_admin()`):

- `early_access_leads` — id, full_name, phone, email, neighborhood, source, notes, status ('new'|'contacted'|'converted'|'discarded'), timestamps
- `kipper_leads` — id, customer_id, booking_id, full_name, phone, email, status ('pending'|'contacted'|'converted'|'discarded'), notes, timestamps
- `invoices` — id, booking_id, invoice_number, status ('pending'|'issued'|'cancelled'), issued_at, notes, timestamps
- `weekly_availability_rules` — id, day_of_week (0-6), day_name, is_open, start_time, end_time, slot_duration_minutes, interval_minutes, capacity, allow_overlaps, timestamps. Seed 7 rows (Mon–Sat open 09–18 / 90 / 90 / 1; Sun closed).
- `availability_exceptions` — id, date (unique), is_closed, note, timestamps

Updated_at triggers using existing `update_updated_at_column()`.

## Part B — Admin navigation (`AdminSidebar`)

Restructure sidebar with primary items + "Más" group:
- Primary: Dashboard, Reservas, Calendario, Mensajes, Disponibilidad, Clientes, Suscripciones
- CRM & Ventas: Contactos (→ /admin/clientes), Early Access, Leads Kipper
- Operación: Mapa Demanda
- Finanzas: Finanzas, Facturas
- Configuración: Precios, Notificaciones, WhatsApp Config, Botmaker, App Config

## Part C — New admin routes (MVP pages)

All routes use existing `is_admin` RLS. Built with shadcn cards/tables, real data from existing tables when possible.

- `admin.suscripciones.tsx` — coming-soon + repeat customers (group bookings by phone, count ≥2)
- `admin.early-access.tsx` — full CRUD on `early_access_leads`
- `admin.leads-kipper.tsx` — list bookings with notes containing "kipper" (case-insensitive) + manual `kipper_leads` table
- `admin.finanzas.tsx` — aggregations from bookings/payments
- `admin.facturas.tsx` — list completed/paid bookings + invoices table
- `admin.precios.tsx` — services CRUD + read-only surcharges/extras display with backend warning
- `admin.notificaciones.tsx` — communication_logs + future settings note
- `admin.whatsapp-config.tsx` — Botmaker info + link to diagnostics
- `admin.botmaker.tsx` — webhook URL, recent events, recent booking_requests, parser debug
- `admin.app-config.tsx` — read-only business settings (Washero, currency, etc.)
- `admin.mapa-demanda.tsx` — bookings/revenue grouped by neighborhood

## Part D — `/admin/disponibilidad` overhaul

Tabs: Calendario | Generador | Reglas semanales | Bloqueos | Diagnóstico

**Slot list with bulk actions** (Calendario tab):
- Checkbox per slot, select-all-day, select-all-visible
- Sticky bottom bar when selection > 0 showing counts (total / con reservas / sin reservas)
- Bulk actions: Activar, Desactivar, Eliminar (only 0-booking by default with confirm), Cambiar capacidad
- Day-group actions: Seleccionar día, Activar/Desactivar día, Eliminar sin reservas, Regenerar día

**Reglas semanales tab**:
- Row per day with toggles + inputs
- "Generar próximos 14 días" button → uses rules, skips dates with existing slots+bookings

**Bloqueos tab**:
- Date picker, range support, note
- Block: insert exception + set slots inactive for date
- Unblock: delete exception + reactivate slots
- Warn if bookings exist on date

**Diagnóstico tab**:
- Existing overlap detector + actions (select both, delete/disable no-booking one)

**Mobile UX**: card layout < md, sticky action bar, large tap targets.

## Part E — Verify no regressions

- `/reservar` calendar-first flow untouched
- `create-website-booking` and `botmaker-webhook` untouched
- `get-public-availability` untouched
- Mercado Pago untouched

## Technical notes

- New routes only consume existing edge functions or direct supabase client queries with admin RLS
- No service role key in frontend
- Existing `services` and `customers` data reused
- Counts of bookings per slot computed client-side from `bookings` joined by date+time overlap (same logic as availability)
- Weekly rules generation done client-side (admin) inserting into `availability_slots` directly (admin RLS allows it)

Acceptance: all 17 criteria covered. Reports given at end.
