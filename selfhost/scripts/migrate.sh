#!/usr/bin/env bash
# ============================================================================
# Washero — apply Supabase migrations to the self-hosted DB.
#
# Applies supabase/migrations/*.sql in filename order (idempotent) plus the
# optional pg_cron schedules (URLs auto-substituted). Designed to run AFTER the
# DB container has bootstrapped the Supabase base schema (its own first-boot init).
#
# Usage:  bash selfhost/scripts/migrate.sh   (or:  make selfhost-migrate)
#
# Env: reads selfhost/.env via selfhost/scripts/loadenv.sh
# ============================================================================

set -euo pipefail
cd "$(dirname "$0")/../.."

. selfhost/scripts/loadenv.sh

NETWORK="${WASHERO_NETWORK:-washero-selfhost_default}"
MIGRATIONS_DIR="${MIGRATIONS_DIR:-supabase/migrations}"
OPTIONAL_DIR="${OPTIONAL_DIR:-supabase/optional}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"

PSQL() {
  docker run --rm --network="$NETWORK" \
    -e PGPASSWORD="$POSTGRES_PASSWORD" \
    postgres:15-alpine psql \
    -h db -p 5432 -U postgres -d postgres -v ON_ERROR_STOP=1 "$@";
}

echo "==> Applying migrations from $MIGRATIONS_DIR (in filename order)"
for f in "$MIGRATIONS_DIR"/*.sql; do
  [ -e "$f" ] || continue;
  echo "    - $(basename "$f")";
  PSQL -f "$f" >/dev/null;
done

# Optional schedules — auto-substitute the public API host so pg_cron/pg_net
# calls edge functions through the tunnel exactly like they did on hosted.
API_HOST="${WASHERO_API_PUBLIC_URL:-${SUPABASE_PUBLIC_URL:-}}"
if [ -z "$API_HOST" ]; then
  echo "!! WASHERO_API_PUBLIC_URL / SUPABASE_PUBLIC_URL not set in selfhost/.env; cannot auto-substitute optional schedule URLs." >&2
  API_HOST="PLACEHOLDER_API_PUBLIC_URL"
fi
if [ -n "${RUN_OPTIONAL_SCHEDULES:-}" ] && [ "${RUN_OPTIONAL_SCHEDULES:-}" = "1" ]; then
  echo "==> Applying optional pg_cron schedules (RUN_OPTIONAL_SCHEDULES=1)";
  for f in "$OPTIONAL_DIR"/*.sql; do
    [ -e "$f" ] || continue;
    echo "    - $(basename "$f")";
    sed "s|<YOUR_PROJECT_REF>\.supabase\.co|$API_HOST|g" "$f" | PSQL >/dev/null || echo "    !! manual review needed for $(basename "$f")";
  done;
else
  echo "==> Skipping optional schedules (set RUN_OPTIONAL_SCHEDULES=1 to apply)";
fi

echo "==> Done."
