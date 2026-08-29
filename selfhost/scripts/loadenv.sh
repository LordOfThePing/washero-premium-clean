#!/usr/bin/env bash
# Load selfhost/.env into the environment (safe: no interpolation side effects).
# Source via:  . selfhost/scripts/loadenv.sh

ENV_FILE="${WASHERO_ENV_FILE:-selfhost/.env}"
if [ ! -f "$ENV_FILE" ]; then
  echo "!! $ENV_FILE not found. Copy selfhost/.env.example -> $ENV_FILE and fill in real values first." >&2
  exit 1;
fi

set -a
. "$ENV_FILE"
set +a
