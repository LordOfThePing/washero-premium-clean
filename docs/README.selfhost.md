> **Superseded.** This document describes an earlier plan: running the entire
> self-hosted Supabase platform (10 containers) on the shared server. We replaced it with
> a much smaller footprint — one Node service (`backend/`) speaking the same
> auth/REST/storage/functions HTTP protocol, plus plain Postgres. See
> [`docs/README.backend-shim.md`](./README.backend-shim.md) for the current runbook. Kept
> here for reference only.

# Washero — self-hosted DB + backend (Docker Compose) behind a Cloudflare Tunnel

> Why: the hosted Supabase project hit its quota/limit, so we're moving the database and
> backend onto our own Linux server as containers and exposing them through a Cloudflare
> Tunnel instead of Supabase's hosted URLs. The Cloudflare Worker frontend keeps working
> unchanged — it just points at our tunneled API now.

This spins up an **entire local Supabase platform stack** so we don't have to rewrite any of
the app's ~220 `supabase` client call sites, its RLS, its `auth.*` sessions, or its Edge
Functions. Containers in `selfhost/compose.yaml`:

| Container | Role | Host port (loopback only) |
|---|---|---|
| `db` | Postgres 15 (Supabase image) — schema, RLS, pg_cron, pg_net, vault, storage | 5432 |
| `kong` | API gateway — routes /auth, /rest, /storage, /functions, /realtime | 8000/8443 |
| `auth` | GoTrue — sessions, admin/operator auth | 9999 |
| `rest` | PostgREST — the REST API the app calls with supabase.from()/rpc() | 3001 |
| `storage` | Supabase Storage — payment-receipt files + signed URLs | 5000 |
| `realtime` | Realtime (kept for parity; app mostly REST) | 4000 |
| `edge-runtime` | All ~27 Edge Functions (botmaker, whatsapp-agent-worker, bookings…) | 8081 |
| `meta` + `studio` | Supabase Studio DB browser | 8080/3000 |
| `imgproxy` | image transforms for storage | 5001 |

Everything binds to `127.0.0.1` — nothing is exposed publicly except through the tunnel.

---

## 1. Prerequisites (on the Linux VPS)

- Docker Engine + Compose plugin (`docker compose version`).
- [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)
  (or run the optional cloudflared sidecar; you need a Cloudflare account with a domain).
- [Deno](https://deno.com/install) on a machine where you bundle edge functions
  (can be your dev machine, not necessarily the server).
- `openssl` (for secrets).

## 2. Configure secrets

```bash
cd washero-premium-clean/selfhost
cp .env.example .env
openssl rand -hex 32        # -> POSTGRES_PASSWORD, REALTIME_SECRET
openssl rand -hex 32        # -> JWT_SECRET
```

### Mint the anon + service-role keys (signed JWTs)

The keys are JWTs signed with `JWT_SECRET`; the app sends `VITE_SUPABASE_ANON_KEY` as a Bearer
token and PostgREST maps its `role` claim to a DB role. The reliable, no-tooling way to mint
correctly-shaped keys is a one-time `supabase start` (throws away a local project) and copying
its keys:

```bash
# on a dev machine with the Supabase CLI + Docker:
cd washero-premium-clean
supabase start        # boots a throwaway local project
supabase status        # prints ANON_KEY + SERVICE_ROLE_KEY + JWT secret
supabase stop
```

> Copy the **anon key** → `ANON_KEY`, the **service-role key** → `SERVICE_ROLE_KEY`, and the
> printed **JWT secret** → `JWT_SECRET` in `selfhost/.env`. All services share that JWT secret.

Then fill in the public URLs in `selfhost/.env`:
- `SUPABASE_PUBLIC_URL` — e.g. `https://api.washero.ar` (tunneled API origin).
- `SITE_URL` — the frontend origin (e.g. `https://washero.ar`).
- `AUTH_ORIGIN` — Studio origin (e.g. `https://studio.washero.ar`).

## 3. Bundle the Edge Functions (once, and after every function change)

```bash
bash selfhost/scripts/build-functions.sh     # requires deno
cp selfhost/edge-runtime/.env.functions.example selfhost/edge-runtime/.env.functions
# fill in every secret you used to set via 'supabase secrets set'
# (see supabase/functions/.env.example for the full list)
```

> Our functions use relative `_shared` imports plus `npm:web-push@3.6.7`; `deno bundle` handles
> them, but the first run needs network to fetch npm deps. If `web-push` refuses, add
> `--node-modules-dir` to the deno bundle line (see the script).

## 4. Start the DB + backend stack

```bash
cd washero-premium-clean
make selfhost-up          # or: docker compose -f selfhost/compose.yaml up -d
make selfhost-status      # watch healthchecks go green
```

On first boot the `supabase/postgres` image initializes the Supabase schemas + service roles.
Then apply Washero's schema migrations in order (idempotent):

```bash
make selfhost-migrate      # applies supabase/migrations/*.sql via psql
# optional pg_cron schedules (worker sweep / finance sync):
RUN_OPTIONAL_SCHEDULES=1 make selfhost-migrate
```

Verify locally before the tunnel:
```bash
curl http://127.0.0.1:8000/health                           # Kong up
curl http://127.0.0.1:8000/rest/v1/ -H "apikey: <ANON_KEY>"   # PostgREST reaches DB
curl http://127.0.0.1:3000                                   # Studio loads
```

## 5. Expose via Cloudflare Tunnel

### 5a. Create the tunnel
```bash
cloudflared tunnel login          # authorize your Cloudflare account
cloudflared tunnel create washero # prints a <tunnel-id>.json credential + tunnel name
cloudflared tunnel route dns washero api.washero.ar
cloudflared tunnel route dns washero studio.washero.ar
```

### 5b. Run it (config-file mode, simplest on a raw VPS)
```bash
cp ./selfhost/cloudflared/config.yml.example ./selfhost/cloudflared/config.yml
# edit config.yml: set 'tunnel:' to your tunnel name, 'credentials-file:' to the copied <id>.json
mv ~/.cloudflared/<tunnel-id>.json ./selfhost/cloudflared/tunnel.json
cloudflared tunnel --config ./selfhost/cloudflared/config.yml run washero
```

Or use the **compose sidecar** with a dashboard-managed token:
```bash
cp selfhost/cloudflared/.env.example selfhost/cloudflared/.env
# put your TUNNEL_TOKEN in it, then:
docker compose -f selfhost/compose.yaml -f selfhost/compose.cloudflared.yaml up -d
```

Then in the Zero Trust dashboard (Networks → Tunnels → washero → Public Hostnames) add:

| Hostname | Service |
|---|---|
| `api.washero.ar` | `http://kong:8000` |
| `studio.washero.ar` | `http://studio:3000` |

> The tunnel routes ALL Supabase services through Kong on `api.washero.ar` because the app uses
> supabase-js against one origin — `/auth/v1`, `/rest/v1`, `/storage/v1`, `/functions/v1` all live
> under it. If you hit WebSocket issues on /realtime, disable HTTP/2 upstream (cloudflared config).

## 6. Point the Cloudflare Worker / frontend at the new API

Update the **build-time env** (workspace `.env` and wherever you build/deploy the Worker):

```
VITE_SUPABASE_URL=https://api.washero.ar
VITE_SUPABASE_PUBLISHABLE_KEY=<the ANON_KEY from selfhost/.env>
VITE_SUPABASE_ANON_KEY=<the ANON_KEY>
VITE_SUPABASE_PROJECT_ID=washero-selfhost
SUPABASE_URL=https://api.washero.ar                # server-side admin client
SUPABASE_SERVICE_ROLE_KEY=<the SERVICE_ROLE_KEY>   # server-side admin client
```

Rebuild + redeploy the Worker: `make deploy-frontend` (or your CI).

> **Storage caveat:** create the `payment-receipts` bucket in Studio (or SQL) after migrating and
> confirm the function's bucket name matches, or receipts won't load.

## 7. Post-deploy verification

- [ ] `https://api.washero.ar/rest/v1/` returns a PostgREST response with a valid apikey.
- [ ] `https://api.washero.ar/auth/v1/health` returns healthy.
- [ ] Frontend /reservar loads and get-logistic-availability returns slots.
- [ ] Admin/operator login works (GoTrue sessions) and RLS still filters rows.
- [ ] Studio at studio.washero.ar can browse public tables.
- [ ] whatsapp-agent-worker cron fires (check cron.job_run_details).
- [ ] A payment receipt uploads (Storage) and the signed URL resolves.

## 8. Teardown / ops

```bash
make selfhost-down        # stop all containers
make selfhost-logs        # tail logs
make selfhost-reset       # stop + delete DB volume (wipes data)
docker compose -f selfhost/compose.yaml ps
```

Back up `selfhost/volumes/db/data`, `selfhost/volumes/storage`, and your private keys (JWT_SECRET,
service-role key) — losing them means re-issuing sessions and re-signing API tokens.

---

## Notes & gotchas

- **All ports are loopback-bound.** Do not publish host ports publicly; the tunnel is the only
  ingress to kong/studio. If using the cloudflared sidecar, keep ports off entirely.
- The `supabase/postgres` image owns Postgres init; our migrations run *after* it is up (not via
  docker-entrypoint-initdb.d), so re-running `selfhost-migrate` is safe and idempotent.
- `verify_jwt=false` functions (webhooks like botmaker-webhook, mercadopago-webhook) are reachable
  at `https://api.washero.ar/functions/v1/<name>` with no JWT — keep external providers pointed at
  these and their shared secrets set in `edge-runtime/.env.functions`.
- Delete the old hosted Supabase project only after this stack is proven behind the tunnel and data
  is migrated — see `docs/OWNERSHIP-MIGRATION.md`.
