-- Scheduling for the whatsapp-agent-worker durability sweep (production-hardening audit finding
-- #3 — "worker scheduling"). This file is exact, ready-to-run SQL, NOT just a description — but
-- it lives outside supabase/migrations/ (which `supabase db push` applies automatically and
-- wholesale) and must be run manually, by you, via the SQL editor, because it depends on two
-- things only you can verify/provide from the Supabase Dashboard:
--
-- PREREQUISITE 1 — enable the extensions this needs (I cannot confirm these are available/
-- enabled on your project from here):
--   Dashboard -> Database -> Extensions -> enable "pg_cron" and "pg_net".
--   (Equivalent SQL, run once as a superuser via the SQL editor: create extension if not exists
--   pg_cron; create extension if not exists pg_net; — omitted from this migration file itself so
--   it doesn't hard-fail the standard migration chain on a project where you haven't enabled them
--   yet or don't have permission to.)
--
-- PREREQUISITE 2 — store the worker's shared secret in Supabase Vault, NOT in this file (this
-- file may be committed to git; the secret must never be). Run once, manually, in the SQL editor,
-- with the real value substituted (the SAME value you set via `supabase secrets set
-- WHATSAPP_AGENT_WORKER_SECRET=...` for the edge function itself):
--   select vault.create_secret('<same value as WHATSAPP_AGENT_WORKER_SECRET>', 'whatsapp_agent_worker_secret');
--
-- Once both prerequisites are done, run the statement below.
--
-- *** PROJECT REF WARNING — READ BEFORE RUNNING ***
-- The url below contains <YOUR_PROJECT_REF>, a placeholder. You MUST replace it with the ref of
-- the Supabase project you are running this SQL editor against — find it in that project's
-- Dashboard -> Project Settings -> General -> Reference ID, or in the URL editor tab itself
-- (https://supabase.com/dashboard/project/<ref>/sql). It must match the SAME project you are
-- connected to right now, in this SQL editor tab — nothing else enforces that for you.
-- This project's own ref (washero-premium-clean's Supabase project) is domslcbxgqbylmciqrxt,
-- already public in src/routes/admin.botmaker.tsx's webhook-URL display, not a secret — but do
-- NOT assume it: if you ever run this same file against a different project (a staging/testing
-- Supabase project, for example), using domslcbxgqbylmciqrxt there would silently schedule a cron
-- job in the wrong project's pg_cron that calls THIS (production) project's worker function
-- instead of the one you're actually testing. There is no automatic guard against this — pg_cron
-- and pg_net will happily call any URL, including a different project's, with no warning.
-- Before running: confirm (1) which project this SQL editor tab is connected to, and (2) that the
-- url below's ref matches it. When in doubt, copy the ref straight from the browser's address bar.
--
-- INVOCATION FREQUENCY: every 1 minute. Reasoning: the job lease is 45s (job-queue.ts's
-- LEASE_SECONDS) — a genuinely abandoned job becomes reclaimable within ~45s of its worker going
-- silent, and a 1-minute sweep cadence means it's picked back up within roughly one lease window
-- of becoming eligible, without polling aggressively enough to matter cost-wise. Most jobs never
-- reach the sweep at all — they're already handled by the webhook's own EdgeRuntime.waitUntil()
-- fast path; this cron job exists purely as the durability fallback plus the outbound-retry flush
-- (see whatsapp-agent-worker/index.ts, which also calls retryFailedOutboundSends).
--
-- AUTHENTICATION / EXACT HEADER FORMAT: a single custom header, not an Authorization/Bearer JWT —
--   x-internal-secret: <the decrypted vault secret>
-- Supabase's platform-level JWT verification is OFF for this function (verify_jwt = false in
-- config.toml — see whatsapp-agent-worker/index.ts's own header comment for why: pg_cron/pg_net
-- can't easily mint a user JWT, and the worker doesn't need user-level authorization, only "is
-- this call coming from our own scheduler"). Do not add an Authorization header here — it would be
-- ignored by the function and would not substitute for the secret check.
--
-- OVERLAP PROTECTION: pg_cron's net.http_post is fire-and-forget (async) from cron's own
-- perspective, so it does NOT block one tick until the previous invocation finishes — meaning
-- overlapping worker invocations are possible and expected, not prevented at the scheduling layer.
-- This is safe because overlap protection is enforced one layer down, at the job-claim level:
-- claim_next_whatsapp_agent_job() (migration 20260722100400) is safe to call from any number of
-- simultaneous invocations, and the per-conversation lease (job-lease.ts) ensures only one of them
-- can ever be actively working a given conversation's job at a time; outbound sends have their own
-- equivalent atomic claim (migration 20260722100700).
--
-- FAILURE VISIBILITY / HOW TO INSPECT FAILED CRON RUNS:
--   -- pg_cron's own run history (success/failure per tick, return message):
--   select * from cron.job_run_details
--     where jobid = (select jobid from cron.job where jobname = 'whatsapp-agent-worker-sweep')
--     order by start_time desc limit 20;
--   -- pg_net's raw HTTP outcomes for those calls:
--   select * from net._http_response order by created desc limit 20;
--   -- Per-job failures (durable, not just this run's log): whatsapp_agent_jobs.last_error, and
--   -- status = 'dead' once a job exhausts its retry budget — surfaced via
--   -- whatsapp-agent-diagnostics's `status` action (dead_jobs_total). Worth alerting on if that
--   -- climbs.
--
-- HOW TO REMOVE / DISABLE THE SCHEDULE:
--   select cron.unschedule('whatsapp-agent-worker-sweep');   -- removes it entirely
--   -- there is no built-in "pause" — unschedule and re-run the cron.schedule(...) call below
--   -- later to re-enable it.
--
-- HOW TO ROTATE THE WORKER SECRET (do both sides — they must match):
--   1. Generate a new random secret value yourself (e.g. `openssl rand -hex 32`).
--   2. Update the Edge Function's copy:  supabase secrets set WHATSAPP_AGENT_WORKER_SECRET=<new value>
--   3. Update Vault's copy (Vault has no "update" — delete then recreate under the same name):
--        select vault.delete_secret((select id from vault.secrets where name = 'whatsapp_agent_worker_secret'));
--        select vault.create_secret('<new value>', 'whatsapp_agent_worker_secret');
--   The cron job itself reads Vault by name at execution time (see the jsonb_build_object call
--   below), so it automatically picks up the new value on its next tick — no need to re-run
--   cron.schedule(...) after rotating, only after changing the URL/frequency/etc.
--
-- ROLLBACK: select cron.unschedule('whatsapp-agent-worker-sweep');

-- Replace <YOUR_PROJECT_REF> below (see the warning above) before running.
select cron.schedule(
  'whatsapp-agent-worker-sweep',
  '* * * * *', -- every 1 minute
  $$
  select net.http_post(
    url := 'https://<YOUR_PROJECT_REF>.supabase.co/functions/v1/whatsapp-agent-worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-internal-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'whatsapp_agent_worker_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);
