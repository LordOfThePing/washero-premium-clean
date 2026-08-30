// Outbound message idempotency ledger + delivery-outcome classification (production-hardening
// audit findings #7 and, later passes, "outbound delivery ambiguity" and "lease ownership through
// outbound delivery").
//
// Every send goes through sendWhatsAppMessage() (../whatsapp-outbound.ts), which POSTs to the n8n
// "WhatsApp Outbound Gateway" webhook — a plain HTTP call, so the same at-least-once delivery
// caveat applies as with any webhook-based transport: we cannot tell whether a network failure
// happened before or after n8n actually sent the message.
//
// CONCLUSION: outbound delivery here is AT-LEAST-ONCE, not exactly-once, and this module treats
// it that way — it does NOT claim reconciliation-based exactly-once delivery. Every send outcome
// is classified into one of three durable buckets:
//   'sent'      — the gateway returned a definite success response. Considered delivered-enough;
//                 never resent.
//   'failed'    — the gateway returned a definite error response (a real HTTP status, just not
//                 2xx/ok). Nothing was delivered — safe to retry the identical text later.
//   'ambiguous' — we timed out or the connection failed before any response was received. The
//                 gateway may or may not have received/sent the message. NEVER auto-retried —
//                 surfaced for manual admin review instead (see whatsapp-agent-manual-retry/
//                 index.ts and /admin/agente-whatsapp). Booking creation itself stays idempotent
//                 regardless of this classification — see booking-core.ts's idempotency_key,
//                 which is entirely independent of whether the *confirmation text* delivery is
//                 ambiguous.
//
// TWO CONCURRENCY GUARDS, layered, because two different callers have two different amounts of
// context available (production-hardening audit — "lease ownership through outbound delivery"):
//  1. Row-level atomic claim (jobLease or not): every send attempt, regardless of caller, first
//     atomically transitions the outbound row from 'pending'/'retryable' to 'sending' via a
//     conditional UPDATE. If that affects zero rows, another concurrent attempt already claimed
//     it (e.g. two overlapping worker-sweep invocations both trying to retry the same row) — this
//     attempt backs off immediately without ever calling the gateway. This guard applies to every
//     caller, with or without an active job lease.
//  2. Job-lease guard (only when a job is actively being processed, i.e. the FIRST send attempt
//     from job-processor.ts — retries from the worker sweep or manual admin action happen *after*
//     the job that generated the reply is already 'done', so there is no job lease to check by
//     then, and none is required — see "use the same lease-aware outbound pipeline WHERE
//     APPLICABLE"). When a job lease is passed, this module re-verifies it immediately before
//     calling the gateway (never relying only on the earlier check in orchestrator.ts/
//     job-processor.ts) and stamps it onto the row so the final write is also conditioned on it —
//     an obsolete worker whose lease was reclaimed mid-send cannot overwrite whatever the new
//     lease holder already recorded. This narrows, but cannot eliminate, the astronomically rare
//     case of a truly in-flight (uncancellable) fetch completing after reclaim — see module-level
//     honesty note above: delivery is at-least-once, not exactly-once.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { sendWhatsAppMessage } from "../whatsapp-outbound.ts";
import { renewLease } from "./job-queue.ts";

// Matches orchestrator.ts's OUTBOUND_SEND_TIMEOUT_MS (kept as an independent constant here to
// avoid a cross-module dependency on an orchestrator-internal value — see orchestrator.ts's
// MAX_TURN_DURATION_ESTIMATE_MS derivation, which accounts for this same duration).
const OUTBOUND_SEND_TIMEOUT_MS = 20_000;

export type OutboundOutcome =
  | "sent"
  | "failed"
  | "ambiguous"
  | "skipped_dry_run"
  | "already_sent"
  | "already_in_progress"
  | "lease_lost";
export type SendAgentReplyResult = { outcome: OutboundOutcome; error: string | null };

/** Present only when this send is the FIRST attempt, driven by an actively-processing job. */
export type JobLeaseGuard = { jobId: string; leaseToken: string };

class SendTimeoutError extends Error {}

function withSendTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new SendTimeoutError("outbound_send_timeout")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId)) as Promise<T>;
}

/** The subset of SendCloudMessageResult this module's classification cares about. */
export type ClassifiableSendResult = {
  ok: boolean;
  status?: string;
  error?: string | null;
  /** See SendCloudMessageResult.httpResponded: true once the gateway actually returned an HTTP
   * response, as opposed to a network error/timeout where delivery is unknowable. */
  httpResponded?: boolean;
};

export type SendClassification = {
  /** DB status to persist on whatsapp_agent_outbound_messages. */
  dbStatus: "sent" | "retryable" | "ambiguous";
  outcome: OutboundOutcome;
  error: string | null;
};

/**
 * Pure classification logic (production-hardening audit finding — outbound delivery ambiguity),
 * split out from attemptSend so it's unit-testable without a live network call or database. See
 * module doc above for the definitions of 'sent'/'failed'/'ambiguous'.
 */
export function classifySendResult(result: ClassifiableSendResult): SendClassification {
  if (result.ok) {
    return { dbStatus: "sent", outcome: "sent", error: null };
  }

  // Two kinds of definite (non-ambiguous) failure:
  //  - "skipped": sendWhatsAppMessage never even attempted a network call (invalid phone, empty
  //    message, missing gateway config) — nothing was sent, no ambiguity possible.
  //  - a real HTTP response, even an error one: the gateway definitely responded.
  // Anything else (network error with no response, timeout) is NOT definite — the request may
  // have reached the gateway before the connection dropped.
  const gotDefiniteResponse = result.status === "skipped" || result.httpResponded === true;
  if (gotDefiniteResponse) {
    return { dbStatus: "retryable", outcome: "failed", error: result.error ?? "unknown_error" };
  }

  return {
    dbStatus: "ambiguous",
    outcome: "ambiguous",
    error: `no_definite_response: ${result.error ?? "unknown"}`,
  };
}

/** Classification for the case where we gave up waiting before any response arrived at all. */
export function classifyTimeout(): SendClassification {
  return { dbStatus: "ambiguous", outcome: "ambiguous", error: "timeout_awaiting_response" };
}

async function getOrCreateOutboundRow(
  admin: SupabaseClient,
  opts: { jobId: string; conversationId: string; text: string },
) {
  const { data: inserted, error: insertErr } = await admin
    .from("whatsapp_agent_outbound_messages")
    .insert({
      job_id: opts.jobId,
      conversation_id: opts.conversationId,
      message_text: opts.text,
      status: "pending",
    })
    .select("*")
    .maybeSingle();
  if (inserted) return inserted;

  // 23505 = unique_violation on job_id — a prior attempt for this job already has a row.
  if ((insertErr as { code?: string } | null)?.code !== "23505") {
    throw new Error(`failed to create outbound ledger row: ${insertErr?.message}`);
  }
  const { data: existing, error: fetchErr } = await admin
    .from("whatsapp_agent_outbound_messages")
    .select("*")
    .eq("job_id", opts.jobId)
    .single();
  if (fetchErr || !existing)
    throw new Error(`failed to load existing outbound ledger row: ${fetchErr?.message}`);
  return existing;
}

/**
 * Sends (or, in dry-run mode, records without sending) the agent's reply for one job. Safe to
 * call more than once for the same jobId: 'sent'/'skipped_dry_run' rows are never resent, and
 * 'ambiguous' rows are deliberately never auto-resent either (see module doc above) — only
 * 'failed'/'retryable' rows (a *definite* prior rejection) are retried automatically, via
 * retryFailedOutboundSends below.
 */
export async function sendAgentReplyOnce(
  admin: SupabaseClient,
  opts: {
    jobId: string;
    conversationId: string;
    phone: string;
    text: string;
    customerName?: string | null;
    bookingId?: string | null;
    dryRun: boolean;
    /** Only present for the first-attempt path from job-processor.ts — see module doc. */
    jobLease?: JobLeaseGuard;
  },
): Promise<SendAgentReplyResult> {
  const row = await getOrCreateOutboundRow(admin, {
    jobId: opts.jobId,
    conversationId: opts.conversationId,
    text: opts.text,
  });

  if (row.status === "sent") return { outcome: "already_sent", error: null };
  if (row.status === "skipped_dry_run") return { outcome: "skipped_dry_run", error: null };
  if (row.status === "ambiguous") {
    return {
      outcome: "ambiguous",
      error: "previous attempt was ambiguous — awaiting manual review, not auto-retrying",
    };
  }

  if (opts.dryRun) {
    await admin
      .from("whatsapp_agent_outbound_messages")
      .update({ status: "skipped_dry_run" })
      .eq("id", row.id);
    return { outcome: "skipped_dry_run", error: null };
  }

  return attemptSend(admin, row.id, {
    phone: opts.phone,
    text: opts.text,
    customerName: opts.customerName,
    bookingId: opts.bookingId,
    jobLease: opts.jobLease,
  });
}

async function attemptSend(
  admin: SupabaseClient,
  rowId: string,
  opts: {
    phone: string;
    text: string;
    customerName?: string | null;
    bookingId?: string | null;
    jobLease?: JobLeaseGuard;
  },
): Promise<SendAgentReplyResult> {
  // Guard 2 (job-lease path only): immediate, re-verified-here ownership check — never rely only
  // on a check performed earlier in the orchestrator/job-processor. An obsolete worker must not
  // reach the send call at all.
  if (opts.jobLease) {
    const stillOwns = await renewLease(admin, opts.jobLease.jobId, opts.jobLease.leaseToken);
    if (!stillOwns) {
      console.warn(
        "[whatsapp-agent/outbound] lease lost immediately before send — refusing to send",
        {
          job_id: opts.jobLease.jobId,
        },
      );
      return { outcome: "lease_lost", error: "lease_lost_before_send" };
    }
  }

  // Guard 1 (always): atomic claim. Two concurrent attempts at the same row (e.g. overlapping
  // worker-sweep invocations both retrying the same 'retryable' row) can't both proceed — only
  // the one whose UPDATE actually matches a row moves on to send.
  const claimUpdate: Record<string, unknown> = { status: "sending" };
  if (opts.jobLease) claimUpdate.lease_token = opts.jobLease.leaseToken;
  const { data: claimed, error: claimErr } = await admin
    .from("whatsapp_agent_outbound_messages")
    .update(claimUpdate)
    .eq("id", rowId)
    .in("status", ["pending", "retryable"])
    .select("id");
  if (claimErr) {
    console.error("[whatsapp-agent/outbound] failed to claim outbound row for sending", claimErr);
    return { outcome: "ambiguous", error: `claim_failed: ${claimErr.message}` };
  }
  if (!claimed || claimed.length === 0) {
    console.warn(
      "[whatsapp-agent/outbound] outbound row already claimed by another attempt, backing off",
      { row_id: rowId },
    );
    return { outcome: "already_in_progress", error: null };
  }

  let classification: SendClassification;
  let providerMessageId: string | null = null;
  try {
    const result = await withSendTimeout(
      sendWhatsAppMessage(admin, {
        phone: opts.phone,
        kind: "text",
        text: opts.text,
        customerName: opts.customerName ?? undefined,
        bookingId: opts.bookingId ?? undefined,
      }),
      OUTBOUND_SEND_TIMEOUT_MS,
    );
    classification = classifySendResult(result);
    providerMessageId = result.provider_message_id ?? null;
  } catch (e) {
    // Includes SendTimeoutError: we gave up waiting, but the underlying fetch may still complete
    // in the background (it isn't aborted) and will log its real outcome to communication_logs
    // whenever it does — the ledger row here just can't wait for that.
    classification =
      e instanceof SendTimeoutError
        ? classifyTimeout()
        : {
            dbStatus: "ambiguous",
            outcome: "ambiguous",
            error: String((e as Error)?.message ?? e),
          };
  }

  const update: Record<string, unknown> = {
    status: classification.dbStatus,
    error: classification.error,
  };
  if (classification.dbStatus === "sent") {
    update.provider_message_id = providerMessageId;
    update.sent_at = new Date().toISOString();
    update.error = null;
  }

  // Only the active lease holder may persist the result — condition the write on the token we
  // stamped at claim time. If a newer worker has since reclaimed the job and written its own
  // result (or reclaimed the row some other way), this affects zero rows and we correctly do NOT
  // overwrite it. Retry-path sends (no jobLease) have no token to check — guard 1's atomic claim
  // already gave them exclusive ownership of this row for the duration of the send.
  let query = admin.from("whatsapp_agent_outbound_messages").update(update).eq("id", rowId);
  if (opts.jobLease) query = query.eq("lease_token", opts.jobLease.leaseToken);
  const { data: written, error: writeErr } = await query.select("id");
  if (writeErr) {
    console.error("[whatsapp-agent/outbound] failed to persist send result", writeErr);
  } else if (!written || written.length === 0) {
    console.warn(
      "[whatsapp-agent/outbound] lease lost during send — result computed but NOT persisted to avoid overwriting a newer worker's result",
      { row_id: rowId },
    );
    return { outcome: "lease_lost", error: "lease_lost_after_send" };
  }

  return { outcome: classification.outcome, error: classification.error };
}

/**
 * Retries only DEFINITE prior failures ('retryable') — never 'ambiguous' ones. Intended to be
 * called from the periodic worker sweep so a failed-but-known-undelivered message eventually goes
 * out without having to re-run the whole agent turn (the reply text is already decided and
 * stored). No job lease is available or required here — see module doc's guard 1.
 */
export async function retryFailedOutboundSends(
  admin: SupabaseClient,
  opts: { maxRows?: number } = {},
): Promise<number> {
  // Two plain queries instead of a nested embed: PostgREST's embed-result typing defaults foreign
  // rows to an array shape without generated Database types available in Deno Edge Functions,
  // which fights the TS checker for no real benefit here — this is simpler and just as cheap.
  const { data: rows, error } = await admin
    .from("whatsapp_agent_outbound_messages")
    .select("id, message_text, conversation_id")
    .eq("status", "retryable")
    .order("created_at", { ascending: true })
    .limit(opts.maxRows ?? 10);
  if (error) {
    console.error("[whatsapp-agent/outbound] retryFailedOutboundSends query failed", error);
    return 0;
  }
  const pending = (rows ?? []) as Array<{
    id: string;
    message_text: string;
    conversation_id: string;
  }>;
  if (pending.length === 0) return 0;

  const conversationIds = [...new Set(pending.map((r) => r.conversation_id))];
  const { data: conversations, error: convErr } = await admin
    .from("whatsapp_agent_conversations")
    .select("id, customer_phone, customer_name, booking_id")
    .in("id", conversationIds);
  if (convErr) {
    console.error(
      "[whatsapp-agent/outbound] retryFailedOutboundSends conversation lookup failed",
      convErr,
    );
    return 0;
  }
  const conversationById = new Map(
    (
      (conversations ?? []) as Array<{
        id: string;
        customer_phone: string;
        customer_name: string | null;
        booking_id: string | null;
      }>
    ).map((c) => [c.id, c]),
  );

  let retried = 0;
  for (const row of pending) {
    const conv = conversationById.get(row.conversation_id);
    if (!conv) {
      console.warn(
        "[whatsapp-agent/outbound] retryable outbound row has no matching conversation, skipping",
        row.id,
      );
      continue;
    }
    await attemptSend(admin, row.id, {
      phone: conv.customer_phone,
      text: row.message_text,
      customerName: conv.customer_name,
      bookingId: conv.booking_id,
    });
    retried++;
  }
  return retried;
}
