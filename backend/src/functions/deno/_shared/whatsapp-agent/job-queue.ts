// @ts-nocheck -- ported verbatim from supabase/functions; not our source of truth for types
// Durable job queue for async webhook processing (production-hardening audit finding #1 and #2).
// All exclusivity guarantees live in Postgres (claim_next_whatsapp_agent_job), not in this
// process's memory — required because Edge Function instances are stateless/ephemeral and
// multiple instances (the webhook's own waitUntil call and the periodic worker sweep) can be
// claiming jobs at the same moment.
//
// Lease model (second-pass correctness fix): claiming a job grants a lease (lease_token +
// lease_expires_at), not a permanent hold. Only the caller presenting the matching lease_token
// may renew, complete, or fail the job — see renewLease/markJobDone/markJobFailed below, all of
// which filter on lease_token so an obsolete worker (one that lost its lease to a reclaim) can
// never overwrite a newer worker's state. See job-processor.ts for the renewal heartbeat loop and
// orchestrator.ts for the documented worst-case turn duration the lease interval is chosen around.
import type { SupabaseClient } from "@supabase/supabase-js";

export type AgentJobStatus = "pending" | "processing" | "done" | "failed" | "dead";

export type AgentJobRow = {
  id: string;
  conversation_id: string;
  external_message_id: string | null;
  message_text: string;
  source: "webhook" | "diagnostics";
  dry_run: boolean;
  status: AgentJobStatus;
  attempts: number;
  last_error: string | null;
  lease_token: string | null;
  lease_expires_at: string | null;
  locked_at: string | null;
  created_at: string;
  updated_at: string;
};

/** How long a granted/renewed lease remains valid without another renewal. Must comfortably
 * exceed LEASE_RENEWAL_INTERVAL_MS (job-processor.ts) — NOT the total job duration, since the
 * lease is renewed throughout a long-running turn. See job-processor.ts for the full rationale. */
export const LEASE_SECONDS = 45;

export async function enqueueJob(
  admin: SupabaseClient,
  opts: {
    conversationId: string;
    messageText: string;
    externalMessageId?: string | null;
    source?: "webhook" | "diagnostics";
    dryRun?: boolean;
  },
): Promise<AgentJobRow> {
  const { data, error } = await admin
    .from("whatsapp_agent_jobs")
    .insert({
      conversation_id: opts.conversationId,
      message_text: opts.messageText,
      external_message_id: opts.externalMessageId ?? null,
      source: opts.source ?? "webhook",
      dry_run: !!opts.dryRun,
    })
    .select("*")
    .single();
  if (error || !data) throw new Error(`failed to enqueue whatsapp_agent_job: ${error?.message}`);
  return data as AgentJobRow;
}

/**
 * Claims the oldest pending job whose conversation has no other job currently 'processing', and
 * grants it a fresh lease (see LEASE_SECONDS). Returns null when there is nothing eligible to
 * claim right now (not an error — callers should just stop looping).
 */
export async function claimNextJob(
  admin: SupabaseClient,
  opts: { leaseSeconds?: number } = {},
): Promise<AgentJobRow | null> {
  const { data, error } = await admin.rpc("claim_next_whatsapp_agent_job", {
    p_lease_seconds: opts.leaseSeconds ?? LEASE_SECONDS,
  });
  if (error) {
    console.error("[whatsapp-agent/job-queue] claim_next_whatsapp_agent_job failed", error);
    return null;
  }
  return (data as AgentJobRow | null) ?? null;
}

/**
 * Extends the lease by LEASE_SECONDS from now, but only if `leaseToken` still matches — i.e.
 * only if nobody has reclaimed this job out from under the caller. Returns false when the lease
 * was lost (job reclaimed, already completed, or otherwise no longer owned by this token); the
 * caller MUST stop doing any further mutating work the moment this returns false.
 */
export async function renewLease(
  admin: SupabaseClient,
  jobId: string,
  leaseToken: string,
  leaseSeconds: number = LEASE_SECONDS,
): Promise<boolean> {
  const leaseExpiresAt = new Date(Date.now() + leaseSeconds * 1000).toISOString();
  const { data, error } = await admin
    .from("whatsapp_agent_jobs")
    .update({ lease_expires_at: leaseExpiresAt })
    .eq("id", jobId)
    .eq("lease_token", leaseToken)
    .eq("status", "processing")
    .select("id");
  if (error) {
    console.error("[whatsapp-agent/job-queue] renewLease failed, treating lease as lost", error);
    return false;
  }
  return (data?.length ?? 0) > 0;
}

/** Only succeeds if `leaseToken` still matches — an obsolete worker cannot mark a job done. */
export async function markJobDone(
  admin: SupabaseClient,
  jobId: string,
  leaseToken: string,
): Promise<boolean> {
  const { data, error } = await admin
    .from("whatsapp_agent_jobs")
    .update({ status: "done", last_error: null })
    .eq("id", jobId)
    .eq("lease_token", leaseToken)
    .select("id");
  if (error) {
    console.error("[whatsapp-agent/job-queue] markJobDone failed", error);
    return false;
  }
  return (data?.length ?? 0) > 0;
}

/** attempts is incremented at claim time — pass the row so we can decide pending vs dead here.
 * Only succeeds if `leaseToken` still matches — an obsolete worker cannot mark a job failed
 * (which would otherwise let it clobber a newer worker's already-completed result). */
export async function markJobFailed(
  admin: SupabaseClient,
  job: Pick<AgentJobRow, "id" | "attempts">,
  leaseToken: string,
  error: string,
  opts: { maxAttempts?: number } = {},
): Promise<boolean> {
  const maxAttempts = opts.maxAttempts ?? 4;
  const status: AgentJobStatus = job.attempts >= maxAttempts ? "dead" : "pending";
  const { data, error: dbError } = await admin
    .from("whatsapp_agent_jobs")
    .update({ status, last_error: error.slice(0, 2000), lease_token: null, lease_expires_at: null })
    .eq("id", job.id)
    .eq("lease_token", leaseToken)
    .select("id");
  if (dbError) {
    console.error("[whatsapp-agent/job-queue] markJobFailed failed", dbError);
    return false;
  }
  return (data?.length ?? 0) > 0;
}

/** Clears rows a previous, failed attempt at this same job wrote, so a retry starts clean. */
export async function cleanupPriorAttemptMessages(
  admin: SupabaseClient,
  jobId: string,
): Promise<void> {
  await admin.from("whatsapp_agent_messages").delete().eq("job_id", jobId);
}
