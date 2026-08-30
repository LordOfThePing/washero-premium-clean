// Durability sweep for the WhatsApp agent job queue (production-hardening audit — "worker
// authentication and scheduling"; must NOT be publicly invokable).
//
// EdgeRuntime.waitUntil() in webhook-handler.ts is best-effort — if an instance recycles mid-turn,
// that in-flight processing is lost, but the job row stays 'processing' until its lease expires
// (see job-lease.ts / claim_next_whatsapp_agent_job, migration 20260722100400), at which point
// it's reclaimable again. This function is meant to be invoked on a schedule (pg_cron + pg_net —
// see supabase/optional/whatsapp_agent_worker_schedule.sql for the exact, ready-to-run config) so
// those abandoned jobs — and any definitely-failed outbound sends — actually get finished instead
// of sitting forever.
//
// Auth: a dedicated shared-secret header (x-internal-secret), not a Supabase JWT — pg_cron's
// net.http_post and most external cron services can't easily mint one, and an ordinary
// authenticated user's JWT must never be treated as worker authorization; this endpoint doesn't
// even look at Authorization headers. The secret lives only as an Edge Function secret (set via
// `supabase secrets set WHATSAPP_AGENT_WORKER_SECRET=...`) / Supabase Vault for the cron job's own
// copy — never hardcoded, never logged, compared via worker-auth.ts's constant-time check.
//
// Overlap safety: this function does not itself prevent overlapping invocations (e.g. two cron
// ticks firing close together, or a manual trigger racing the schedule) — it doesn't need to,
// because every job it processes goes through claim_next_whatsapp_agent_job's atomic,
// lease-granting claim (migration 20260722100400) and every outbound send goes through
// outbound.ts's row-level atomic claim (migration 20260722100700). Two overlapping sweeps simply
// end up claiming disjoint sets of work.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { runJobProcessingLoop } from "../_shared/whatsapp-agent/job-processor.ts";
import { retryFailedOutboundSends } from "../_shared/whatsapp-agent/outbound.ts";
import { isValidWorkerSecret } from "../_shared/whatsapp-agent/worker-auth.ts";

const MAX_JOBS_PER_INVOCATION = 25;
const MAX_OUTBOUND_RETRIES_PER_INVOCATION = 10;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-internal-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const API_URL = Deno.env.get("API_URL")!;
const SERVICE_ROLE = Deno.env.get("SERVICE_ROLE_KEY")!;
const WORKER_SECRET = Deno.env.get("WHATSAPP_AGENT_WORKER_SECRET") ?? "";

const admin = createClient(API_URL, SERVICE_ROLE, { auth: { persistSession: false } });

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  // Never treat an ordinary user JWT (or its absence) as worker authorization — this endpoint
  // doesn't look at Authorization/JWTs at all, only this dedicated secret header. Never log the
  // provided or configured secret value, on any path.
  if (!(await isValidWorkerSecret(req.headers.get("x-internal-secret"), WORKER_SECRET))) {
    return json({ ok: false, error: "Unauthorized" }, 401);
  }

  try {
    const processed = await runJobProcessingLoop(admin, { maxJobs: MAX_JOBS_PER_INVOCATION });
    // Definite (non-ambiguous) outbound failures get one retry attempt per sweep — see
    // outbound.ts's module doc for why 'ambiguous' rows are deliberately excluded from this.
    const outboundRetried = await retryFailedOutboundSends(admin, {
      maxRows: MAX_OUTBOUND_RETRIES_PER_INVOCATION,
    });
    return json({ ok: true, processed, outbound_retried: outboundRetried });
  } catch (e) {
    // Persisted for admin visibility via Supabase's function logs; per-job failures are also
    // durably persisted on whatsapp_agent_jobs.last_error (and status='dead' once retries are
    // exhausted) — surfaced via whatsapp-agent-diagnostics's `status` action (dead_jobs_total).
    console.error("[whatsapp-agent-worker] sweep failed", e);
    return json({ ok: false, error: "server_error" }, 500);
  }
});
