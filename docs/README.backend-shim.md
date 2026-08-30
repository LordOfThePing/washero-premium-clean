# Washero backend shim — self-hosted, minimal footprint

Replaces the hosted Supabase project (which hit its project limit) with:

- **Plain Postgres** holding the same schema (`db/migrations/*.sql`, replayed
  unmodified) plus a small `auth`/`storage` schema bootstrap so RLS policies written
  against `auth.uid()`/`auth.role()` and the storage bucket tables work the same way.
- **One Node service** (`backend/`, Fastify) that speaks the subset of the
  supabase-js HTTP protocol the frontend actually uses: `/auth/v1/*`, `/rest/v1/*`
  (a hand-rolled PostgREST-equivalent), `/storage/v1/*`, and `/functions/v1/<name>`
  (the ~27 edge functions, ported from Deno and run in-process).

This is intentionally much lighter than running the full self-hosted Supabase stack
(10 containers) — it leaves the shared server's resources free for the other project
("Vuelto"). The frontend (`src/`) is **unchanged**: it still uses `@supabase/supabase-js`
against `VITE_API_URL` / `VITE_ANON_KEY`, and the server-side
Worker middleware still calls `supabase.auth.getClaims()` — those env vars just point at
this shim's tunneled URL instead of `*.supabase.co`.

## How the pieces map to Supabase

| Supabase concept | This shim |
|---|---|
| PostgREST (`/rest/v1/*`) | `backend/src/rest/*` — parses the PostgREST querystring (`select=`, `eq.`/`in.`/`ilike.`/… filters, `order=`, `limit`/`offset`/`Range`, `or=(...)`, embedded-resource selects via FK introspection) into SQL, runs it with the caller's Postgres role (`anon`/`authenticated`/`service_role`) so RLS applies exactly as before. |
| GoTrue (`/auth/v1/*`) | `backend/src/auth/routes.ts` — email/password login against `auth.users` (bcrypt), HS256 JWTs signed with `JWT_SECRET`, refresh tokens in `auth.refresh_tokens`. `getClaims()` on HS256 projects always calls `GET /auth/v1/user`, which is implemented. |
| Storage (`/storage/v1/*`) | `backend/src/storage/routes.ts` — bucket/object metadata in Postgres (`storage.buckets`/`storage.objects`, same shape Supabase uses), file bytes on local disk under `STORAGE_DIR`. Signed URLs are short-lived JWTs. |
| Edge Functions (`/functions/v1/<name>`) | `backend/src/functions/deno/<name>/index.ts` — **the original Deno source, copied verbatim** (see below) and run under Node via a tiny `Deno.serve()`/`Deno.env.get()` shim (`functions/deno-compat.ts`). Each function's own `createClient(API_URL, SERVICE_ROLE_KEY)` calls loop back into this same server, which is why no business logic needed rewriting. |

### Why the edge functions didn't need a rewrite

Every ported function still does `createClient(API_URL, SERVICE_ROLE_KEY)`
internally. `backend/src/index.ts` sets `API_URL=http://127.0.0.1:<port>` (itself)
before loading them, so their `admin.from(...)`, `admin.auth.getUser(...)`,
`admin.storage.from(...).createSignedUrl(...)` calls transparently hit this shim's own
REST/Auth/Storage routes instead of hosted Supabase. Only the import specifiers and
`Deno.env.get` calls were mechanically rewritten (`https://esm.sh/@supabase/supabase-js@…`
→ `@supabase/supabase-js`, `Deno.env.get("X")` → `process.env.X`); the business logic in
`backend/src/functions/deno/**` is untouched. **Do not hand-edit those files** — instead
edit the source of truth at `functions/**` and re-run the copy step (see
"Updating a ported function" below).

Type-checking those vendored files is intentionally disabled (`// @ts-nocheck`, added by
the copy step) — they were written against Deno's laxer defaults, not this project's
strict tsconfig, and re-deriving perfect types for ~5000 lines of vendored logic wasn't a
good use of time. Everything else in `backend/src/` (rest, auth, storage, db) is fully
type-checked.

## Local development

```bash
cd backend
cp .env.example .env      # fill in DATABASE_URL, JWT_SECRET, ANON_KEY, SERVICE_ROLE_KEY, secrets
npm install
npm run migrate           # bootstrap.sql (roles/schemas/auth.uid()) + db/migrations/*.sql
npm run dev                # tsx watch src/index.ts
```

Postgres must have **pg_cron** available (some migrations `CREATE EXTENSION pg_cron`) —
use an image that bundles it, e.g. `public.ecr.aws/supabase/postgres:17.6.1.143`, not
plain `postgres:17-alpine`. pg_cron's actual scheduled jobs (booking reminders, WhatsApp
agent worker sweeps, finance sync) don't run inside Postgres here the way they might on
hosted Supabase edge-runtime cron — trigger them from system cron / n8n instead, hitting
`POST /functions/v1/send-booking-reminders`, `/whatsapp-agent-worker`,
`/sync-finance-expenses` with `Authorization: Bearer <SERVICE_ROLE_KEY>`.

Create your first admin user directly in Postgres (there is no signup flow — the app
never calls `signUp`):

```sql
insert into auth.users (email, encrypted_password)
values ('owner@washero.ar', crypt('a-strong-password', gen_salt('bf')))
returning id;

insert into public.admin_users (user_id, email, role, active)
values ('<id from above>', 'owner@washero.ar', 'owner', true);
```

(`crypt`/`gen_salt` come from `pgcrypto`, enabled by `bootstrap.sql`.)

## Verifying it works

```bash
# login
curl -s -X POST "http://127.0.0.1:8000/auth/v1/token?grant_type=password" \
  -H 'content-type: application/json' \
  -d '{"email":"owner@washero.ar","password":"a-strong-password"}'
# -> { access_token, refresh_token, expires_in, user: {...} }

TOKEN=... # access_token from above

# REST
curl -s "http://127.0.0.1:8000/rest/v1/services?select=id,name&order=name" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN"

# RPC
curl -s -X POST "http://127.0.0.1:8000/rest/v1/rpc/get_my_admin_profile" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{}'

# a function
curl -s -X POST "http://127.0.0.1:8000/functions/v1/get-public-availability" \
  -H "apikey: $ANON_KEY" -H 'content-type: application/json' -d '{}'
```

## Updating a ported function

The Deno sources under `functions/**` remain the source of truth for edge
function business logic. To re-sync after editing them:

```bash
# from the repo root
rm -rf backend/src/functions/deno
mkdir -p backend/src/functions/deno
for d in functions/*/; do
  name=$(basename "$d"); [ "$name" = "_shared" ] && continue
  mkdir -p "backend/src/functions/deno/$name"
  for f in "$d"*.ts; do
    base=$(basename "$f")
    [[ "$base" == *.test.ts || "$base" == index.ts ]] && [ "$base" != index.ts ] && continue
    cp "$f" "backend/src/functions/deno/$name/$base"
  done
done
mkdir -p backend/src/functions/deno/_shared
find functions/_shared -type f -name "*.ts" ! -name "*.test.ts" ! -name "*.integration.test.ts" \
  -exec bash -c 'rel="${1#functions/_shared/}"; mkdir -p "backend/src/functions/deno/_shared/$(dirname "$rel")"; cp "$1" "backend/src/functions/deno/_shared/$rel"' _ {} \;

cd backend/src/functions/deno
find . -type f -name "*.ts" -print0 | xargs -0 sed -i \
  -e 's#https://esm.sh/@supabase/supabase-js@[0-9.]*#@supabase/supabase-js#g' \
  -e 's#npm:web-push@3.6.7#web-push#g' \
  -e 's#Deno\.env\.get(#process.env.___get(#g'
find . -type f -name "*.ts" -print0 | xargs -0 perl -pi -e 's/process\.env\.___get\("([A-Za-z0-9_]+)"\)/process.env.$1/g'
find . -name "*.ts" -print0 | xargs -0 -I{} sh -c 'grep -q "@ts-nocheck" "{}" || sed -i "1i // @ts-nocheck -- ported verbatim from functions; not our source of truth for types" "{}"'
```

Then `cd backend && npm run build` to confirm the rest of the shim still type-checks.

## Running in production: everything as containers

`docker-compose.yml` at the repo root defines the whole self-hosted stack as containers —
`db` (Postgres + pg_cron), `migrate` (runs once, applies `db/migrations/*.sql`, then exits),
`backend` (this shim), and `cloudflared` (the tunnel itself, no host-installed daemon needed).
This shares the server with Vuelto by using a different `COMPOSE_PROJECT_NAME`/network and a
separate tunnel hostname — see the top of `docker-compose.yml`.

```bash
cp backend/.env.example backend/.env   # fill in real secrets (see above)
docker compose up -d --build
docker compose logs -f backend         # confirm "Server listening at http://0.0.0.0:8000"
```

`DATABASE_URL` in `backend/.env` should point at the `db` service by its Compose service
name (`postgres://...@db:5432/washero`), not `localhost` — containers reach each other by
service name on the Compose network.

### Cloudflare Tunnel (containerized)

The `cloudflared` service runs `cloudflared tunnel run` using a tunnel token
(`CLOUDFLARE_TUNNEL_TOKEN` in `backend/.env` or a root `.env`) from a tunnel you create once
in the Cloudflare dashboard (Zero Trust → Networks → Tunnels), with a public hostname
(e.g. `api.washero.ar`) routed to `http://backend:8000` (the Compose service name + port,
not `localhost`). No public ports need opening on the VPS.

### Pointing the frontend at it

Nothing in `src/` changes. Set, wherever the frontend build/deploy pulls its env from:

```
VITE_API_URL=https://api.washero.ar
VITE_ANON_KEY=<ANON_KEY from backend/.env>
API_URL=https://api.washero.ar
ANON_KEY=<ANON_KEY>
SERVICE_ROLE_KEY=<SERVICE_ROLE_KEY from backend/.env>
```

(`API_URL`/`ANON_KEY` are read server-side by `src/integrations/db/auth-middleware.ts`;
`SERVICE_ROLE_KEY` by `src/integrations/db/client.server.ts`.)

## Known gaps / what to verify before fully cutting over

- **Realtime is not implemented** — confirmed unused by the frontend (0 `.channel(...)`
  call sites) when this was built, but re-check if that's changed.
- **PostgREST feature coverage is pragmatic, not exhaustive**: covers every filter
  operator/select pattern found in `src/` at the time of writing (`eq`, `neq`, `gt`,
  `gte`, `lt`, `lte`, `like`, `ilike`, `in`, `is`, `not.`, `or=(...)`, one level of
  embedded-resource selects via FK introspection, `count=exact`, `.single()`/
  `.maybeSingle()`, `on_conflict`/upsert). A new call site using an operator not in that
  list (e.g. full-text search, `cs`/`cd` array containment beyond the basics) will need a
  small addition to `backend/src/rest/query-builder.ts`.
- **Some edge functions are faithful ports but still depend on external services**
  (the n8n WhatsApp Outbound Gateway, MercadoPago, web-push/VAPID, Google Maps/Sheets) that
  need real secrets in `backend/.env` to actually do anything — they were not re-tested
  against those live services here, only type-checked and load-tested for wiring (no 404s,
  correct auth gating).
- Any function directory under `functions/*` that has no corresponding
  `backend/src/functions/deno/<name>/index.ts` responds `501 not_implemented` with a
  clear message instead of a 404 — grep `backend/src/functions/deno` to confirm every
  name `supabase.functions.invoke(...)` is called with in `src/` has one.
