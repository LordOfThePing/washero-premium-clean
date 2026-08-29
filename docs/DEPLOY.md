# Washhero — Application Deployment Runbook

> Everything needed to deploy the **Washero** app to production: frontend (Cloudflare Workers /
> TanStack Start), backend (Supabase), and third-party services.
> Companion deployment notes for the WhatsApp cutover: `docs/n8n-whatsapp-cloudapi-cutover.md`.
> Companion ownership-migration runbook (own accounts, from scratch): `docs/OWNERSHIP-MIGRATION.md`.

## Stack

- **Frontend:** TanStack Start (React 19) + Nitro SSR, Vite, Tailwind 4 → **Cloudflare Workers**
  (`vite.config.ts`'s `nitro({ preset: "cloudflare_module" })`; static assets served via the
  Workers Assets binding).
- **Backend:** **Supabase** — Postgres + RLS + auth + ~27 Edge Functions, storage, pg_cron.
- **Payments:** MercadoPago (optional — see `WASHERO_SKIP_PAYMENT` below for a payment-free test mode).
- **Integrations:** Google Maps, Google Sheets/Forms (finance sync), Web Push, WhatsApp (Botmaker →
  Cloud API cutover in progress).

## 1. Frontend deploy (Cloudflare Workers)

```bash
bun install          # or npm install (lockfiles for both present)
npm run build        # Vite build; Nitro emits the Worker + static assets to .output/
npm run deploy       # Vite build && wrangler deploy --config .output/server/wrangler.json
npm run start        # Local Workers-runtime preview via `wrangler dev` (after a build)
```

First-time setup: `npx wrangler login` to authenticate the CLI with your Cloudflare account. The
worker name is pinned to `washero` in `vite.config.ts` (`cloudflare.wrangler.name`) — without it
Nitro auto-derives a name from the git remote, which would carry over the previous owner's name.

Cloudflare **secrets** (`WHATSAPP_CLOUD_API_TOKEN`-style values the *frontend* needs at runtime, if
any — most secrets in this app belong to Supabase Edge Functions, not the frontend) are set with
`npx wrangler secret put <NAME>`, not via `.env` — `.env`/`VITE_*` vars are build-time only and end
up in the public JS bundle.

### Build-time env vars (`.env` locally; Cloudflare Pages/Workers dashboard → Settings →
Environment Variables in production, or bake them into the CI build step)

All `VITE_*` are public and bundled into client JS — only put safe-to-expose values here.

| Var | Required? | Purpose |
|---|---|---|
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_PROJECT_ID` / `VITE_SUPABASE_ANON_KEY` (+ `VITE_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`) | Yes | Supabase client wiring |
| `VITE_GOOGLE_MAPS_PUBLIC_KEY` | **Yes** | Places autocomplete + admin demand map; restrict by referrer to your production domain(s) — without it booking shows "Falta configurar Google Maps." |
| `VITE_ADDRESS_FIRST_BOOKING` | Yes (prod default `true`) | Address-first booking flow |
| `VITE_WEB_PUSH_PUBLIC_KEY` | Yes | Operator PWA push |
| `VITE_GOOGLE_ADS_ID`, `VITE_GOOGLE_ADS_BOOKING_CONVERSION_LABEL`, `VITE_GOOGLE_ADS_PAYMENT_CONVERSION_LABEL` | No | Google Ads conversion tracking |

> `src/integrations/supabase/client.ts` reads `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY`
> (or `VITE_SUPABASE_ANON_KEY`) from the build env — confirm they point at the target project before
> a production deploy.

## 2. Supabase

### 2.1 Project & auth
- External Supabase project (ref `domslcbxgqbylmciqrxt`). Auth enabled (admin + operator roles).
- Config in `supabase/config.toml` (per-function `verify_jwt`).

### 2.2 Migrations
Apply in order (idempotent):
- `supabase/migrations/*` — schema, RLS, atomic RPCs (`create_booking_atomic`,
  `cancel_booking_atomic`, `reschedule_booking_atomic`, `claim_next_whatsapp_agent_job`, rolling
  availability generator + daily pg_cron).
- Seeding: services, pricing items, coverage zones, private neighborhoods, 14-day availability.
- New WhatsApp-cutover migration: `supabase/migrations/20260821000000_botmaker_conversation_transport.sql`.

### 2.3 Edge Functions
`supabase functions deploy <name>` for each function listed in `supabase/config.toml`, e.g.:
`create-website-booking`, `create-admin-booking`, `create-subscription-booking`, `mercadopago-webhook`,
`botmaker-webhook`, `botmaker-tools`, `botmaker-booking-tools`, `get-logistic-availability`,
`get-public-availability`, `validate-address-location`, `operator-*`, `send-booking-reminders`,
`send-operator-push`, `washi-agent`, `approve-payment-receipt`, `sync-finance-expenses`, etc.

### 2.4 Edge Function secrets
`supabase secrets set KEY=value` (see `supabase/functions/.env.example`). Set:
- Core: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`
- Payments: `MERCADOPAGO_ACCESS_TOKEN`
- Google: `GOOGLE_MAPS_SERVER_KEY`
- Web push: `WEB_PUSH_VAPID_PUBLIC_KEY`, `WEB_PUSH_VAPID_PRIVATE_KEY`, `WEB_PUSH_VAPID_SUBJECT`
- Site: `PUBLIC_SITE_URL=https://washero.ar`
- WhatsApp/Botmaker (+ Cloud API cutover): `BOTMAKER_*`, `WASHI_AGENT_SECRET`, `PUSH_INTERNAL_SECRET`,
  `BOTMAKER_TOOLS_SECRET`, plus `WHATSAPP_CLOUD_API_TOKEN`, `WHATSAPP_CLOUD_PHONE_NUMBER_ID`,
  `WASHERO_TRANSPORT=cloud_api` (see cutover docs).
- Finance sync: `GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON`, `GOOGLE_SHEETS_SPREADSHEET_ID`,
  `GOOGLE_SHEETS_RANGE`, `FINANCE_SYNC_SECRET`.

> Do **not** set `ANTHROPIC_API_KEY` or `WHATSAPP_AGENT_MODE` (the no-Anthropic architecture keeps
> the Claude agent path disabled).

## 3. Third-party services

- **MercadoPago** — access token; webhook secret for `mercadopago-webhook`.
- **Google Cloud** — Maps JS + Places API browser key (public, referrer-restricted); a Sheets
  service account for expenses sync.
- **Web Push** — VAPID keypair (public in build env, private in Supabase secrets).
- **WhatsApp** — currently Botmaker; switching to Meta Cloud API (see cutover docs).

## 4. Promoting users to admin

Via Supabase SQL Editor:
```sql
insert into public.admin_users (user_id, email, role, active)
values ('<auth-user-uuid>', 'admin@washero.ar', 'admin', true);
```

## 5. Post-deploy verification checklist

- [ ] Frontend loads, booking funnel reaches `/reservar`, Google Maps autocomplete works.
- [ ] MercadoPago checkout + webhook → booking confirmed + `booking_confirmed_v2` WhatsApp.
- [ ] `get-logistic-availability` returns slots; no double-booking (atomic RPC).
- [ ] `/admin` auth works; `/admin/mensajes` shows conversations; operator push fires.
- [ ] Supabase function warm-ups return 200 (dashboard/smoke calls).
- [ ] After WhatsApp cutover: inbound conversations appear in `/admin/mensajes` via n8n; outbound
  lifecycle + operator messages go through the Cloud API.
