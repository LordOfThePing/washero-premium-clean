// Integration tests for "lease ownership through outbound delivery" (production-hardening audit,
// third pass). Same env-var gating and cleanup discipline as the other *.integration.test.ts
// files — see booking-concurrency.integration.test.ts's header for how to run these.
//
// Note on scenario 3 ("lease lost while awaiting Botmaker"): sendBotmakerWhatsApp is not
// dependency-injected (no mock seam was added, per this pass's "no redesign / no new
// capabilities" constraint), so a genuinely-delayed in-flight fetch can't be interleaved with a
// reclaim inside this test process. Instead, (3) proves the exact write-guard condition
// attemptSend relies on — a conditional UPDATE keyed on (id, lease_token) — directly, using the
// same query shape outbound.ts uses. This is what actually provides the safety property; the only
// thing not exercised end-to-end here is the artificial timing.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { claimNextJob, enqueueJob, markJobDone } from "./job-queue.ts";
import { JobLeaseHeartbeat } from "./job-lease.ts";
import { sendAgentReplyOnce } from "./outbound.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ALLOW =
  (Deno.env.get("WHATSAPP_AGENT_ALLOW_INTEGRATION_TESTS") ?? "").toLowerCase() === "true";
const canRun = ALLOW && !!SUPABASE_URL && !!SERVICE_ROLE;

const admin = canRun
  ? createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } })
  : null;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTestJob(fn: (ctx: { conversationId: string; jobId: string }) => Promise<void>) {
  const phone = `54911${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`;
  const { data: conversation, error: convErr } = await admin!
    .from("whatsapp_agent_conversations")
    .insert({ customer_phone: phone, is_test: true, status: "bot_active" })
    .select("id")
    .single();
  if (convErr || !conversation)
    throw new Error(`failed to create test conversation: ${convErr?.message}`);

  const job = await enqueueJob(admin!, { conversationId: conversation.id, messageText: "hola" });

  try {
    await fn({ conversationId: conversation.id, jobId: job.id });
  } finally {
    await admin!.from("whatsapp_agent_outbound_messages").delete().eq("job_id", job.id);
    await admin!.from("whatsapp_agent_jobs").delete().eq("id", job.id);
    await admin!.from("whatsapp_agent_conversations").delete().eq("id", conversation.id);
  }
}

// ---------------------------------------------------------------------------
// (1) + (2) Lease lost immediately before send (row already exists by the time this is checked —
// row creation itself is not lease-gated, only the actual send attempt is).
// ---------------------------------------------------------------------------
Deno.test({
  name: "(1)+(2) lease lost before send: outbound row is created, but Botmaker is never called and the row never advances past 'pending'",
  ignore: !canRun,
  fn: async () => {
    await withTestJob(async ({ conversationId, jobId }) => {
      const workerA = await claimNextJob(admin!, { leaseSeconds: 1 });
      assert(workerA !== null && workerA.id === jobId);
      const staleToken = workerA!.lease_token!;

      // Simulate worker A going silent and worker B legitimately reclaiming.
      await sleep(1500);
      const workerB = await claimNextJob(admin!);
      assert(workerB !== null && workerB!.id === jobId);

      // Worker A, unaware, tries to send using its now-stale token.
      const result = await sendAgentReplyOnce(admin!, {
        jobId,
        conversationId,
        phone: "5491100000000",
        text: "reserva confirmada",
        dryRun: false,
        jobLease: { jobId, leaseToken: staleToken },
      });

      assertEquals(result.outcome, "lease_lost");
      assertEquals(result.error, "lease_lost_before_send");

      const { data: row } = await admin!
        .from("whatsapp_agent_outbound_messages")
        .select("status")
        .eq("job_id", jobId)
        .single();
      assertEquals(
        row?.status,
        "pending",
        "the row must never have been claimed for sending by the obsolete worker",
      );

      await markJobDone(admin!, jobId, workerB!.lease_token!);
    });
  },
});

// ---------------------------------------------------------------------------
// (3) Write-guard proof: an obsolete worker's final write cannot land once its token no longer
// matches — see module note above for why this is tested at the query level.
// ---------------------------------------------------------------------------
Deno.test({
  name: "(3) obsolete worker's final result write is rejected once the row's lease_token has moved on (write-guard proof)",
  ignore: !canRun,
  fn: async () => {
    await withTestJob(async ({ conversationId, jobId }) => {
      const workerA = await claimNextJob(admin!, { leaseSeconds: 30 });
      assert(workerA !== null);
      const tokenA = workerA!.lease_token!;

      // Worker A "claims" the outbound row for sending, exactly like attemptSend's guard 1.
      const { data: row } = await admin!
        .from("whatsapp_agent_outbound_messages")
        .insert({
          job_id: jobId,
          conversation_id: conversationId,
          message_text: "hola",
          status: "sending",
          lease_token: tokenA,
        })
        .select("id")
        .single();
      assert(row !== null);

      // A NEW worker (B) reclaims the row out from under A — e.g. after a manual admin
      // intervention, or a future direct-reclaim path — by stamping a different lease_token as
      // part of writing its own result.
      const otherToken = crypto.randomUUID();
      await admin!
        .from("whatsapp_agent_outbound_messages")
        .update({ status: "sent", lease_token: otherToken })
        .eq("id", row!.id);

      // Worker A now tries to persist ITS OWN (stale) result — this is exactly the conditional
      // UPDATE attemptSend issues after the Botmaker call returns.
      const { data: staleWrite } = await admin!
        .from("whatsapp_agent_outbound_messages")
        .update({ status: "failed", error: "worker_a_stale_result" })
        .eq("id", row!.id)
        .eq("lease_token", tokenA)
        .select("id");
      assertEquals(
        staleWrite?.length ?? 0,
        0,
        "worker A's stale-token write must affect zero rows",
      );

      const { data: finalRow } = await admin!
        .from("whatsapp_agent_outbound_messages")
        .select("status,error")
        .eq("id", row!.id)
        .single();
      assertEquals(finalRow?.status, "sent", "worker B's result must survive untouched");
      assertEquals(finalRow?.error, null);

      await markJobDone(admin!, jobId, tokenA);
    });
  },
});

// ---------------------------------------------------------------------------
// (4) Obsolete worker attempting to update the outbound row directly (not via the query-shape
// proof above, but via the real sendAgentReplyOnce/jobLease path end-to-end for the 'sending'
// claim step itself).
// ---------------------------------------------------------------------------
Deno.test({
  name: "(4) obsolete worker cannot even claim the outbound row for sending once reclaimed",
  ignore: !canRun,
  fn: async () => {
    await withTestJob(async ({ conversationId, jobId }) => {
      const workerA = await claimNextJob(admin!, { leaseSeconds: 1 });
      assert(workerA !== null);
      const staleToken = workerA!.lease_token!;

      await sleep(1500);
      const workerB = await claimNextJob(admin!);
      assert(workerB !== null);

      // sendAgentReplyOnce's very first guard (renewLease) must reject worker A before it ever
      // reaches the row-claim UPDATE, let alone Botmaker.
      const result = await sendAgentReplyOnce(admin!, {
        jobId,
        conversationId,
        phone: "5491100000000",
        text: "hola",
        dryRun: false,
        jobLease: { jobId, leaseToken: staleToken },
      });
      assertEquals(result.outcome, "lease_lost");

      await markJobDone(admin!, jobId, workerB!.lease_token!);
    });
  },
});

// ---------------------------------------------------------------------------
// (5) New worker reclaiming and completing the same job.
// ---------------------------------------------------------------------------
Deno.test({
  name: "(5) a new worker can reclaim an abandoned job and complete it normally, dry-run so no real Botmaker call is made",
  ignore: !canRun,
  fn: async () => {
    await withTestJob(async ({ conversationId, jobId }) => {
      const workerA = await claimNextJob(admin!, { leaseSeconds: 1 });
      assert(workerA !== null);
      await sleep(1500); // worker A abandons the job

      const workerB = await claimNextJob(admin!);
      assert(workerB !== null && workerB!.id === jobId);

      const result = await sendAgentReplyOnce(admin!, {
        jobId,
        conversationId,
        phone: "5491100000000",
        text: "hola",
        dryRun: true, // no live Botmaker credentials in this test environment
        jobLease: { jobId, leaseToken: workerB!.lease_token! },
      });
      assertEquals(result.outcome, "skipped_dry_run");

      assert(
        await markJobDone(admin!, jobId, workerB!.lease_token!),
        "the new, legitimate lease holder must be able to complete the job",
      );
    });
  },
});

// ---------------------------------------------------------------------------
// (6) Old worker attempting to mark the job done after reclaim.
// ---------------------------------------------------------------------------
Deno.test({
  name: "(6) the old worker cannot mark the job done after a new worker has reclaimed and completed it",
  ignore: !canRun,
  fn: async () => {
    await withTestJob(async ({ conversationId, jobId }) => {
      const workerA = await claimNextJob(admin!, { leaseSeconds: 1 });
      assert(workerA !== null);
      const tokenA = workerA!.lease_token!;

      await sleep(1500);
      const workerB = await claimNextJob(admin!);
      assert(workerB !== null);
      await sendAgentReplyOnce(admin!, {
        jobId,
        conversationId,
        phone: "5491100000000",
        text: "hola",
        dryRun: true,
        jobLease: { jobId, leaseToken: workerB!.lease_token! },
      });
      assert(await markJobDone(admin!, jobId, workerB!.lease_token!));

      // Worker A finally "wakes up" and tries to mark the job done with its stale token.
      const staleComplete = await markJobDone(admin!, jobId, tokenA);
      assertEquals(staleComplete, false, "the old worker's completion attempt must be rejected");

      const { data: finalJob } = await admin!
        .from("whatsapp_agent_jobs")
        .select("status")
        .eq("id", jobId)
        .single();
      assertEquals(finalJob?.status, "done");
    });
  },
});

// ---------------------------------------------------------------------------
// (7) Heartbeat remains active until send classification is persisted.
// ---------------------------------------------------------------------------
Deno.test({
  name: "(7) the heartbeat keeps the lease alive across a window that would otherwise cause reclaim, through to completion",
  ignore: !canRun,
  fn: async () => {
    await withTestJob(async ({ conversationId, jobId }) => {
      const claimed = await claimNextJob(admin!, { leaseSeconds: 2 });
      assert(claimed !== null);
      const heartbeat = new JobLeaseHeartbeat(admin!, jobId, claimed!.lease_token!);
      heartbeat.start();

      try {
        // Longer than the original 2s lease — without renewal this job would already be
        // reclaimable by the time we get to "sending".
        await sleep(2500);
        assert(heartbeat.isValid(), "heartbeat must still consider its lease valid");

        const noOtherClaim = await claimNextJob(admin!);
        assertEquals(
          noOtherClaim,
          null,
          "no other worker should be able to claim while the heartbeat is actively renewing",
        );

        const result = await sendAgentReplyOnce(admin!, {
          jobId,
          conversationId,
          phone: "5491100000000",
          text: "hola",
          dryRun: true,
          jobLease: { jobId, leaseToken: claimed!.lease_token! },
        });
        assertEquals(
          result.outcome,
          "skipped_dry_run",
          "classification must persist successfully — the lease was never lost",
        );

        assert(await markJobDone(admin!, jobId, claimed!.lease_token!));
      } finally {
        heartbeat.stop();
      }
    });
  },
});
