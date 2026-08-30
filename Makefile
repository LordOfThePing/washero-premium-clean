# Washero - dev + deploy commands.
#
# Frontend:  TanStack Start / Nitro -> Cloudflare Workers (wrangler)
# Backend:   Supabase (Postgres + Edge Functions), run locally via Docker or deployed remotely
#
# Run `make help` for the full command list. Start with `make setup` on a fresh checkout.

SHELL := bash
.DEFAULT_GOAL := help
.PHONY: help setup install env \
        db-up db-down db-reset db-status functions-serve dev studio \
        build typecheck lint test preview \
        cf-login cf-whoami deploy-frontend \
        sb-login sb-link db-push deploy-functions secrets-push deploy-backend \
        deploy migration-new clean \
        selfhost-up selfhost-down selfhost-status selfhost-logs selfhost-reset \
        selfhost-migrate selfhost-functions \
        deploy-env

# Override on the command line, e.g. `make sb-link REF=abcdefgh`
REF ?=
FUNCTIONS_ENV := supabase/functions/.env

help: ## Show this help
	@echo ""
	@echo "Washero - available commands"
	@echo ""
	@awk 'BEGIN {FS = ":.*##"} /^[a-zA-Z_-]+:.*?##/ { printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2 }' $(MAKEFILE_LIST)
	@echo ""
	@echo "Typical local dev: make setup, then three terminals - make db-up / make functions-serve / make dev"
	@echo "Typical deploy:    make deploy-backend   (Supabase: migrations + functions + secrets)"
	@echo "                    make deploy-frontend (Cloudflare Workers)"
	@echo ""

# ---------------------------------------------------------------------------
# Setup
# ---------------------------------------------------------------------------

setup: install env ## First-time setup: install deps + scaffold .env files
	@echo "Now fill in .env and $(FUNCTIONS_ENV), then run: make db-up"

install: ## Install frontend dependencies (bun)
	bun install

env: ## Scaffold .env / $(FUNCTIONS_ENV) from their .example files if missing
	@if [ ! -f .env ]; then cp .env.example .env && echo "Created .env - fill in real values."; else echo ".env already exists, leaving it alone."; fi
	@if [ ! -f $(FUNCTIONS_ENV) ]; then cp supabase/functions/.env.example $(FUNCTIONS_ENV) && echo "Created $(FUNCTIONS_ENV) - fill in real values."; else echo "$(FUNCTIONS_ENV) already exists, leaving it alone."; fi

# ---------------------------------------------------------------------------
# Local dev (Supabase via Docker + frontend via Vite)
# ---------------------------------------------------------------------------

db-up: ## Start the local Supabase stack (Postgres, Auth, Storage, Studio) in Docker
	supabase start

db-down: ## Stop the local Supabase stack
	supabase stop

db-reset: ## Re-apply all migrations to the local database from scratch (drops local data)
	supabase db reset

db-status: ## Show local Supabase URLs/keys (API, DB, Studio)
	supabase status

studio: ## Print the local Supabase Studio URL
	@echo "Studio:  http://127.0.0.1:54323"
	@echo "API:     http://127.0.0.1:54321"
	@echo "DB:      postgresql://postgres:postgres@127.0.0.1:54322/postgres"

functions-serve: ## Serve all Edge Functions locally against the local DB (needs db-up first)
	supabase functions serve --env-file $(FUNCTIONS_ENV)

dev: ## Run the frontend dev server (needs db-up + functions-serve running for a full stack)
	npm run dev

# ---------------------------------------------------------------------------
# Build / checks
# ---------------------------------------------------------------------------

build: ## Production build (Nitro emits the Cloudflare Worker + static assets to .output/)
	npm run build

typecheck: ## Frontend TypeScript check (src/** only - Edge Functions are Deno, not covered)
	npm run typecheck

lint: ## ESLint
	npm run lint

test: ## Vitest (frontend unit tests)
	npm run test

preview: build ## Build, then run the built Worker locally on the real Workers runtime
	npm run start

# ---------------------------------------------------------------------------
# Cloudflare Workers deploy (frontend)
# ---------------------------------------------------------------------------

cf-login: ## Authenticate wrangler with your Cloudflare account (first-time only)
	npx wrangler login

cf-whoami: ## Show which Cloudflare account wrangler is authenticated as
	npx wrangler whoami

deploy-frontend: build ## Build and deploy the frontend to Cloudflare Workers
	npm run deploy

# ---------------------------------------------------------------------------
# Supabase deploy (backend)
# ---------------------------------------------------------------------------

sb-login: ## Authenticate the Supabase CLI (first-time only)
	supabase login

sb-link: ## Link this repo to a Supabase project - usage: make sb-link REF=<project-ref>
	@if [ -z "$(REF)" ]; then echo "Usage: make sb-link REF=<project-ref>  (find it in the Supabase dashboard URL)"; exit 1; fi
	supabase link --project-ref $(REF)

db-push: ## Push local migrations to the linked remote Supabase project
	supabase db push --linked

deploy-functions: ## Deploy all Edge Functions to the linked remote Supabase project
	supabase functions deploy

secrets-push: ## Push all secrets from $(FUNCTIONS_ENV) to the linked remote Supabase project
	@if [ ! -f $(FUNCTIONS_ENV) ]; then echo "$(FUNCTIONS_ENV) not found - run 'make env' and fill it in first."; exit 1; fi
	supabase secrets set --env-file $(FUNCTIONS_ENV)

deploy-backend: db-push deploy-functions secrets-push ## Full backend deploy: migrations + functions + secrets

# ---------------------------------------------------------------------------
# Everything
# ---------------------------------------------------------------------------

deploy: deploy-backend deploy-frontend ## Full deploy: Supabase backend, then Cloudflare frontend

migration-new: ## Create a new empty migration file - usage: make migration-new NAME=add_foo_column
	@if [ -z "$(NAME)" ]; then echo "Usage: make migration-new NAME=<description>"; exit 1; fi
	supabase migration new $(NAME)

clean: ## Remove local build artifacts (.output, .wrangler) - does not touch node_modules or the DB
	rm -rf .output .wrangler
# ===========================================================================
# Self-hosted backend (selfhost/) - Docker Compose Supabase stack + tunnel
# ===========================================================================
# Runs the DB + backend locally (or on a VPS) as containers and exposes them
# through a Cloudflare Tunnel instead of hosted Supabase.
# See docs/README.selfhost.md for the full runbook + how to mint keys.

SELFHOST_DIR := selfhost
SELFHOST_COMPOSE := $(SELFHOST_DIR)/compose.yaml
SELFHOST_COMPOSE_TUNNEL := $(SELFHOST_DIR)/compose.cloudflared.yaml
SELFHOST_ENV := $(SELFHOST_DIR)/.env

.PHONY: selfhost-check-env
selfhost-check-env:
	@if [ ! -f $(SELFHOST_ENV) ]; then echo "Missing $(SELFHOST_ENV) - copy $(SELFHOST_DIR)/.env.example -> $(SELFHOST_ENV) and fill it in."; exit 1; fi

selfhost-up: selfhost-check-env ## Start the self-hosted Supabase stack in Docker
	docker compose -f $(SELFHOST_COMPOSE) up -d

selfhost-down: ## Stop the self-hosted Supabase stack (keeps DB data)
	docker compose -f $(SELFHOST_COMPOSE) down

selfhost-status: ## Show status + health of the self-hosted stack
	docker compose -f $(SELFHOST_COMPOSE) ps

selfhost-logs: ## Tail logs for the self-hosted stack
	docker compose -f $(SELFHOST_COMPOSE) logs -f

selfhost-reset: ## Stop the stack AND delete the DB volume (WIPES DATA)
	docker compose -f $(SELFHOST_COMPOSE) down -v

selfhost-migrate: selfhost-check-env ## Apply supabase/migrations to the self-hosted DB (idempotent); add RUN_OPTIONAL_SCHEDULES=1 for cron jobs
	bash $(SELFHOST_DIR)/scripts/migrate.sh

selfhost-functions: ## Bundle Edge Functions into the self-hosted edge-runtime (needs Deno)
	bash $(SELFHOST_DIR)/scripts/build-functions.sh

selfhost-up-tunnel: selfhost-check-env ## Start stack + cloudflared tunnel sidecar
	docker compose -f $(SELFHOST_COMPOSE) -f $(SELFHOST_COMPOSE_TUNNEL) up -d

# ===========================================================================
# VPS deploy (docker-compose.yml at repo root: db + backend + cloudflared)
# ===========================================================================
# Copies the .env files docker-compose.yml needs (root .env.docker, backend/.env)
# to a checkout of this repo on the VPS. Override on the command line, e.g.
#   make deploy-env SSH_HOST=hetzner REMOTE_DIR=~/washero-premium-clean

SSH_HOST ?= hetzner
REMOTE_DIR ?= ~/washero-premium-clean

.PHONY: deploy-env
deploy-env: ## Print the scp commands to copy all .env files to the VPS
	@echo scp .env .env.docker $(SSH_HOST):$(REMOTE_DIR)/ ^&^& scp backend/.env $(SSH_HOST):$(REMOTE_DIR)/backend/.env

