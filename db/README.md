# Washero — Database

Plain, self-hosted Postgres (no hosted Supabase). Schema lives here as an ordered set of
idempotent SQL migrations, applied by the backend shim, not by any external CLI.

- `migrations/` — the real, current schema: tables, RLS policies, RPC functions, seed data.
  Applied in filename order by `backend/src/migrate.ts` (`cd backend && npm run migrate`),
  which also runs `backend/sql/bootstrap.sql` first (roles, `auth`/`storage` schemas,
  `auth.uid()`/`auth.role()` helpers) and `backend/sql/post-migrate.sql` last (grants).
- `optional/` — SQL snippets for scheduled jobs (e.g. `pg_cron` schedules for the WhatsApp
  agent worker and finance-expenses sync) that aren't required for the app to run, applied
  manually if/when you want that specific automation.
- `legacy/` — an old, superseded bootstrap script from before the migration system existed.
  Kept for history only; not applied anywhere.

See `docs/README.backend-shim.md` for the full setup/runbook (bootstrapping Postgres,
running migrations, creating the first admin user).
