-- Scheduling for the whatsapp-agent-worker durability sweep (production-hardening audit finding
-- #3 — "worker scheduling"). Lives outside db/migrations/ (which the backend's migrate script
-- applies automatically and wholesale) and must be run manually against the `db` container,
-- because it depends on the `backend` service's WHATSAPP_AGENT_WORKER_SECRET value, which only
-- you have.
--
-- PREREQUISITE — enable pg_cron and pg_net (the Supabase postgres image used in
-- docker-compose.yml's `db` service bundles both; run once as superuser if not already enabled):
--   create extension if not exists pg_cron;
--   create extension if not exists pg_net;
--
-- Only used if you're actually running the in-house Claude WhatsApp agent (WHATSAPP_AGENT_MODE
-- != disabled) — the n8n/Cloud API path (see docs/n8n-whatsapp-cloudapi-cutover.md) doesn't need
-- this at all.
--
-- INVOCATION FREQUENCY: every 1 minute. Reasoning: the job lease is 45s (job-queue.ts's
-- LEASE_SECONDS) — a genuinely abandoned job becomes reclaimable within ~45s of its worker going
-- silent, and a 1-minute sweep cadence means it's picked back up within roughly one lease window
-- of becoming eligible, without polling aggressively enough to matter cost-wise. Most jobs never
-- reach the sweep at all — they're already handled by the inbound handler's own fast path; this
-- cron job exists purely as the durability fallback plus the outbound-retry flush (see
-- whatsapp-agent-worker/index.ts, which also calls retryFailedOutboundSends).
--
-- AUTHENTICATION: a single custom header, not an Authorization/Bearer JWT --
--   x-internal-secret: <the same value as WHATSAPP_AGENT_WORKER_SECRET in backend/.env>
-- The value below is a placeholder -- replace it before running, and NEVER commit the real
-- secret to this file (there is no Supabase Vault to defer to on plain Postgres; treat this
-- statement itself as sensitive once you've filled it in -- run it interactively, don't check in
-- the filled-in version).
--
-- OVERLAP PROTECTION: net.http_post is fire-and-forget (async) from cron's own perspective, so
-- it does NOT block one tick until the previous invocation finishes -- overlapping worker
-- invocations are possible and expected, not prevented at the scheduling layer. This is safe
-- because overlap protection is enforced one layer down, at the job-claim level:
-- claim_next_whatsapp_agent_job() is safe to call from any number of simultaneous invocations,
-- and the per-conversation lease (job-lease.ts) ensures only one of them can ever be actively
-- working a given conversation's job at a time; outbound sends have their own equivalent atomic
-- claim.
--
-- FAILURE VISIBILITY:
--   select * from cron.job_run_details
--     where jobid = (select jobid from cron.job where jobname = 'whatsapp-agent-worker-sweep')
--     order by start_time desc limit 20;
--   select * from net._http_response order by created desc limit 20;
--   -- Per-job failures (durable, not just this run's log): whatsapp_agent_jobs.last_error, and
--   -- status = 'dead' once a job exhausts its retry budget -- surfaced via
--   -- whatsapp-agent-diagnostics's `status` action (dead_jobs_total). Worth alerting on if that
--   -- climbs.
--
-- HOW TO REMOVE / DISABLE: select cron.unschedule('whatsapp-agent-worker-sweep');
--   there is no built-in "pause" -- unschedule and re-run cron.schedule(...) below to re-enable.
--
-- HOW TO ROTATE THE WORKER SECRET (do both sides -- they must match):
--   1. Generate a new value: openssl rand -hex 32
--   2. Update backend/.env's WHATSAPP_AGENT_WORKER_SECRET and restart the backend container.
--   3. Re-run cron.schedule(...) below with the new value baked into the header.

select cron.schedule(
  'whatsapp-agent-worker-sweep',
  '* * * * *', -- every 1 minute
  $$
  select net.http_post(
    url := 'http://backend:8000/functions/v1/whatsapp-agent-worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-internal-secret', '<WHATSAPP_AGENT_WORKER_SECRET -- fill in, do not commit>'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);
