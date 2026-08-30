// Claims and runs whatsapp_agent_jobs. Used both by the webhook's EdgeRuntime.waitUntil() fast
// path and by the periodic worker sweep (whatsapp-agent-worker) — same code, same guarantees,
// regardless of which one actually ends up doing the work for a given job.
//
// Lease discipline (second-pass correctness fix): every job is processed under a renewable lease
// (job-lease.ts). completion/failure updates are always gated on the lease token still matching —
// see job-queue.ts's markJobDone/markJobFailed — so an obsolete worker that lost its lease mid-run
// can never overwrite what the worker that reclaimed the job does afterward.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { claimNextJob, markJobDone, markJobFailed, type AgentJobRow } from "./job-queue.ts";
import { JobLeaseHeartbeat } from "./job-lease.ts";
import { botShouldRespond } from "./handoff.ts";
import { runAgentTurn } from "./orchestrator.ts";
import { sendAgentReplyOnce } from "./outbound.ts";
import type { AgentConversationRow } from "./state.ts";

async function loadConversation(
  admin: SupabaseClient,
  id: string,
): Promise<AgentConversationRow | null> {
  const { data } = await admin
    .from("whatsapp_agent_conversations")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return (data as AgentConversationRow | null) ?? null;
}

export async function processOneJob(admin: SupabaseClient, job: AgentJobRow): Promise<void> {
  if (!job.lease_token) {
    // Should be impossible — claim_next_whatsapp_agent_job always grants a token — but never
    // process a job we can't safely gate completion on.
    console.error(
      "[whatsapp-agent/job-processor] claimed job has no lease_token, refusing to process",
      job.id,
    );
    return;
  }
  const lease = new JobLeaseHeartbeat(admin, job.id, job.lease_token);
  lease.start();

  try {
    // Re-fetch fresh — the conversation's status may have changed (human takeover, admin
    // close, ...) since this job was enqueued. This is the second of two checks: the webhook
    // also checks before enqueueing, but only this check, made right before the turn actually
    // runs, is race-free with respect to a takeover that happens while the job is queued.
    const conversation = await loadConversation(admin, job.conversation_id);
    if (!conversation) {
      await markJobFailed(admin, job, lease.token, "conversation_not_found");
      return;
    }
    if (!botShouldRespond(conversation.status)) {
      console.info(
        "[whatsapp-agent/job-processor] conversation no longer bot-active, dropping job",
        {
          job_id: job.id,
          conversation_id: conversation.id,
          status: conversation.status,
        },
      );
      await markJobDone(admin, job.id, lease.token);
      return;
    }

    const result = await runAgentTurn(admin, conversation, {
      userText: job.message_text,
      externalMessageId: job.external_message_id,
      jobId: job.id,
      dryRun: job.dry_run,
      lease,
    });

    if (result.leaseLost || !lease.isValid()) {
      // Another worker now owns this job. Do not send, do not mark done/failed — any of those
      // writes will simply no-op (0 rows affected) since they're gated on our now-stale token,
      // but skipping them entirely avoids confusing log noise and duplicate work.
      console.warn(
        "[whatsapp-agent/job-processor] lease lost during processing, yielding to new owner",
        { job_id: job.id },
      );
      return;
    }

    if (result.replyText) {
      const sendResult = await sendAgentReplyOnce(admin, {
        jobId: job.id,
        conversationId: conversation.id,
        phone: conversation.customer_phone,
        text: result.replyText,
        customerName: conversation.customer_name,
        bookingId: result.bookingId,
        dryRun: job.dry_run,
        // Lease-aware outbound pipeline (production-hardening audit — "lease ownership through
        // outbound delivery"): this is the FIRST send attempt, made while the job's lease is (as
        // far as we know) still ours — outbound.ts re-verifies immediately before calling
        // the transport rather than trusting this. Retries (worker sweep / manual admin action) run
        // after the job is already 'done' and pass no jobLease — see outbound.ts's module doc.
        jobLease: { jobId: job.id, leaseToken: lease.token },
      });
      // The turn itself succeeded (a reply was generated, any booking already committed via its
      // own idempotency key) regardless of delivery outcome — never re-run the whole turn just
      // to retry a *send*. Definite failures are retried by outbound.retryFailedOutboundSends
      // (worker sweep); ambiguous ones are deliberately left for manual review, never auto-retried.
      if (sendResult.outcome === "lease_lost") {
        // Another worker now legitimately owns this job — do not mark it done/failed ourselves,
        // which would risk clobbering whatever the new owner does. Just yield.
        console.warn(
          "[whatsapp-agent/job-processor] lease lost during outbound send, yielding to new owner",
          { job_id: job.id },
        );
        return;
      }
      if (sendResult.outcome === "ambiguous") {
        console.warn(
          "[whatsapp-agent/job-processor] outbound delivery ambiguous — needs manual review",
          {
            job_id: job.id,
            conversation_id: conversation.id,
            error: sendResult.error,
          },
        );
      } else if (sendResult.outcome === "failed") {
        console.error(
          "[whatsapp-agent/job-processor] outbound delivery definitely failed — will retry via sweep",
          {
            job_id: job.id,
            error: sendResult.error,
          },
        );
      }
    }

    if (!(await markJobDone(admin, job.id, lease.token))) {
      console.warn(
        "[whatsapp-agent/job-processor] markJobDone found no matching lease — lost ownership after send",
        {
          job_id: job.id,
        },
      );
    }
  } catch (e) {
    console.error("[whatsapp-agent/job-processor] job failed", job.id, e);
    await markJobFailed(admin, job, lease.token, String((e as Error)?.message ?? e));
  } finally {
    lease.stop();
  }
}

/**
 * Claims and processes jobs until none are left to claim or maxJobs is reached. Safe to call
 * concurrently from multiple invocations (webhook waitUntil + worker sweep) — claiming is
 * serialized in Postgres, not here.
 */
export async function runJobProcessingLoop(
  admin: SupabaseClient,
  opts: { maxJobs?: number } = {},
): Promise<number> {
  const maxJobs = opts.maxJobs ?? 10;
  let processed = 0;
  for (let i = 0; i < maxJobs; i++) {
    const job = await claimNextJob(admin);
    if (!job) break;
    await processOneJob(admin, job);
    processed++;
  }
  return processed;
}
