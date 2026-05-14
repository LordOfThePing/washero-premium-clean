## Washero — Step 1: App Shell + Routing

Build the clean public + admin shell. No backend tables, no integrations yet. Existing English route stubs (`booking.tsx`, `admin.bookings.tsx`, etc.) will be replaced with the Spanish route structure below.

### 1. Branding (src/styles.css)
- Update design tokens to Washero palette:
  - `--background` white, `--foreground` near-black
  - `--primary` Washero yellow-orange (oklch ~70% / 0.18 / 60), `--primary-foreground` near-black
  - Dark mode: black background, white foreground, same primary
- Set base font (Inter) + tighten heading scale.
- Update `__root.tsx` head: title `Washero — Lavado de autos a domicilio en Zona Norte`, Spanish meta description, lang=`es-AR`.

### 2. Routes (src/routes/)
Delete existing stubs and create:

Public (under new `_public.tsx` pathless layout):
- `_public.tsx` — layout with `<PublicNavbar />` + `<Outlet />` + `<PublicFooter />`
- `_public.index.tsx` → `/` — landing placeholder (hero, CTAs)
- `_public.reservar.tsx` → `/reservar` — booking placeholder card
- `_public.gracias.tsx` → `/gracias` — success placeholder card

Admin (under `admin.tsx` layout; login outside layout):
- `admin.login.tsx` → `/admin/login` — centered login placeholder card (no layout chrome)
- `admin.tsx` → layout with shadcn `SidebarProvider`, `AdminSidebar`, topbar with `SidebarTrigger`, `<Outlet />`
- `admin.index.tsx` → `/admin` — dashboard placeholder
- `admin.reservas.tsx` → `/admin/reservas`
- `admin.calendario.tsx` → `/admin/calendario`
- `admin.disponibilidad.tsx` → `/admin/disponibilidad`
- `admin.clientes.tsx` → `/admin/clientes`
- `admin.configuracion.tsx` → `/admin/configuracion`

The admin layout component must render `<Outlet />` and special-case `/admin/login` by either nesting login outside (preferred: keep `admin.login.tsx` as a sibling but render fullscreen — TanStack matches the deepest route, layout still wraps; alternative: move login to top-level `admin-login.tsx` mapped to `/admin/login`). Will use a pathless `_admin.tsx` layout for protected routes and keep `admin.login.tsx` outside, with paths set explicitly via `createFileRoute('/admin/login')` etc.

Final structure:
```
_public.tsx, _public.index.tsx, _public.reservar.tsx, _public.gracias.tsx
admin.login.tsx                          (no layout)
_admin.tsx                               (sidebar layout, path '/admin' wrapper)
_admin.admin.index.tsx → /admin
_admin.admin.reservas.tsx → /admin/reservas
... etc
```
(Using explicit `createFileRoute` paths so file naming doesn't matter for URL.)

### 3. Components (src/components/)
- `layout/PublicNavbar.tsx` — sticky top, logo "Washero", links Inicio / Reservar lavado / Zonas / Servicios, primary CTA "Reservar lavado", WhatsApp ghost button. Mobile: shadcn `Sheet` drawer.
- `layout/PublicFooter.tsx` — minimal: brand, copyright, WhatsApp link.
- `layout/AdminSidebar.tsx` — shadcn Sidebar (collapsible="icon") with items: Dashboard, Reservas, Calendario, Disponibilidad, Clientes, Configuración (lucide icons). Active state via `useRouterState`.
- `brand/Logo.tsx` — text mark "Washero" with yellow-orange dot.

### 4. Landing placeholder (`/`)
- Hero: H1 "Lavado de autos a domicilio en Zona Norte", subtitle, primary CTA → `/reservar`, secondary "Consultar por WhatsApp" (placeholder `#`).
- Three feature cards (placeholders): Reservá online, Vamos a tu casa, Productos premium.

### 5. Placeholder pages
Each non-landing route renders a centered shadcn `Card` with title + "Próximamente" body.

### 6. Supabase client
Already at `src/integrations/supabase/client.ts` pointing to `domslcbxgqbylmciqrxt`. Confirm `.env` has `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (currently uses `VITE_SUPABASE_PUBLISHABLE_KEY` — will add `VITE_SUPABASE_ANON_KEY` as alias if missing). No DB calls yet.

### 7. Cleanup
- Delete: `src/routes/booking.tsx`, `admin.bookings.tsx`, `admin.calendar.tsx`, `admin.availability.tsx`, `admin.settings.tsx`, old `admin.tsx`, `admin.index.tsx`, `admin.login.tsx`, `index.tsx` (replaced).
- Verify no refs to `azflxjuthcjmkhseycjk` / `pkndizbozytnpgqxymms` (already verified previously).

### Acceptance check
After build: visit `/`, `/reservar`, `/gracias`, `/admin/login`, `/admin`, `/admin/reservas`, `/admin/calendario`, `/admin/disponibilidad`, `/admin/clientes`, `/admin/configuracion` — all render without errors. Report routes, layouts, supabase client path, and old-ref scan result.
