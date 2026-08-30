> **Superseded.** This was the original bootstrap SQL from before the project moved to an
> incremental migration system. It describes an early, much smaller schema and is kept only
> for history — it is not applied anywhere and does not match the current database. The real,
> current schema is `db/migrations/*.sql`, applied via `backend/npm run migrate`
> (see `docs/README.backend-shim.md`).

# Washero — Database (legacy bootstrap, superseded)

This project uses an **external Supabase** project (not Lovable Cloud).
SQL files here must be run manually on your Supabase instance.

## How to apply

Open Supabase → SQL Editor and run, in order:

1. `db/migrations/0001_init_washero.sql` — schema, RLS, policies
2. `db/seed/0001_seed_washero.sql` — services, service areas, 14-day availability

Both scripts are **idempotent** — safe to re-run.

## Tables

`customers`, `service_areas`, `services`, `bookings`, `availability_slots`,
`admin_users`, `payments`, `booking_requests`, `communication_logs`.

## Security model

- RLS is enabled on every table.
- **Public (anon)** can:
  - read active `services`, `service_areas`, `availability_slots`
  - insert into `booking_requests` (intake from website / Botmaker)
- **Public cannot** write to `bookings` directly. Real bookings are created
  server-side from validated `booking_requests` using the **service role key**.
- **Admins** = rows in `admin_users` where `active = true` and `user_id`
  matches `auth.uid()`. Checked via `public.is_active_admin()` (security
  definer, avoids recursive RLS).
- Admins can read/write all operational tables.
- The service role key is **server-only** — never expose it client-side.

## Promoting a user to admin

After the user signs up via Supabase Auth, in SQL Editor:

```sql
insert into public.admin_users (user_id, email, role, active)
values ('<auth-user-uuid>', 'admin@washero.ar', 'admin', true);
```
