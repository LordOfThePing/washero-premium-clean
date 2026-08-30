// Integration tests for the renewable job lease (production-hardening audit finding #1, second
// pass). Same env-var gating and cleanup discipline as the other *.integration.test.ts files —
// see booking-concurrency.integration.test.ts's header for how to run these.
import { assert, assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { claimNextJob, enqueueJob, markJobDone, renewLease } from "./job-queue.ts";

const API_URL = Deno.env.get("API_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SERVICE_ROLE_KEY") ?? "";
const ALLOW =
  (Deno.env.get("WHATSAPP_AGENT_ALLOW_INTEGRATION_TESTS") ?? "").toLowerCase() === "true";
const canRun = ALLOW && !!API_URL && !!SERVICE_ROLE;

const admin = canRun
  ? createClient(API_URL, SERVICE_ROLE, { auth: { persistSession: false } })
  : null;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTestConversation(fn: (conversationId: string) => Promise<void>) {
  const phone = `54911${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`;
  const { data: conversation, error } = await admin!
    .from("whatsapp_agent_conversations")
    .insert({ customer_phone: phone, is_test: true, status: "bot_active" })
    .select("id")
    .single();
  if (error || !conversation)
    throw new Error(`failed to create test conversation: ${error?.message}`);
  try {
    await fn(conversation.id);
  } finally {
    await admin!.from("whatsapp_agent_jobs").delete().eq("conversation_id", conversation.id);
    await admin!.from("whatsapp_agent_conversations").delete().eq("id", conversation.id);
  }
}

Deno.test({
  name: "(a) a long-running valid job that keeps renewing its lease is never reclaimed",
  ignore: !canRun,
  fn: async () => {
    await withTestConversation(async (conversationId) => {
      const job = await enqueueJob(admin!, { conversationId, messageText: "hola" });
      const claimed = await claimNextJob(admin!, { leaseSeconds: 2 });
      assert(claimed !== null && claimed.id === job.id);
      const originalToken = claimed!.lease_token!;

      // Simulate a worker actively renewing every ~0.7s while "processing" for ~2.1s total —
      // longer than the original 2s lease, but never allowed to lapse because it keeps renewing.
      for (let i = 0; i < 3; i++) {
        await sleep(700);
        const renewed = await renewLease(admin!, job.id, originalToken, 2);
        assert(renewed, `renewal ${i} should have succeeded — the lease must not have expired yet`);
      }

      // A second worker trying to claim now must find nothing for this conversation — the job
      // is still legitimately 'processing' under an unexpired, actively-renewed lease.
      const secondClaimAttempt = await claimNextJob(admin!);
      assertEquals(
        secondClaimAttempt,
        null,
        "a still-actively-renewed job must not be reclaimable",
      );

      const done = await markJobDone(admin!, job.id, originalToken);
      assert(
        done,
        "the original worker should still own the lease and be able to complete the job",
      );
    });
  },
});

Deno.test({
  name: "(b) an abandoned job (lease not renewed) becomes reclaimable once its lease expires",
  ignore: !canRun,
  fn: async () => {
    await withTestConversation(async (conversationId) => {
      const job = await enqueueJob(admin!, { conversationId, messageText: "hola" });
      const firstClaim = await claimNextJob(admin!, { leaseSeconds: 1 });
      assert(firstClaim !== null && firstClaim.id === job.id);
      const firstToken = firstClaim!.lease_token!;

      // No renewal — simulate the worker crashing right after claiming.
      await sleep(1500); // past the 1s lease

      const secondClaim = await claimNextJob(admin!);
      assert(
        secondClaim !== null,
        "an abandoned job must become reclaimable once its lease expires",
      );
      assertEquals(secondClaim!.id, job.id);
      assertNotEquals(
        secondClaim!.lease_token,
        firstToken,
        "a reclaim must grant a fresh lease token",
      );

      const done = await markJobDone(admin!, job.id, secondClaim!.lease_token!);
      assert(done);
    });
  },
});

Deno.test({
  name: "(c) a worker that lost its lease cannot complete the job — its stale token is rejected",
  ignore: !canRun,
  fn: async () => {
    await withTestConversation(async (conversationId) => {
      const job = await enqueueJob(admin!, { conversationId, messageText: "hola" });
      const workerA = await claimNextJob(admin!, { leaseSeconds: 1 });
      assert(workerA !== null);
      const tokenA = workerA!.lease_token!;

      // Let A's lease expire, then let worker B reclaim it (A is presumed dead/hung).
      await sleep(1500);
      const workerB = await claimNextJob(admin!);
      assert(workerB !== null && workerB!.id === job.id);
      const tokenB = workerB!.lease_token!;
      assertNotEquals(tokenA, tokenB);

      // Worker A, unaware it lost the lease, tries to renew and to complete — both must fail
      // (this is exactly what job-processor.ts checks before executing a mutating tool or
      // sending an outbound message: lease.isValid() reflects renewLease's return value).
      const renewedByA = await renewLease(admin!, job.id, tokenA);
      assertEquals(
        renewedByA,
        false,
        "an obsolete worker must not be able to renew a lease it no longer holds",
      );

      const completedByA = await markJobDone(admin!, job.id, tokenA);
      assertEquals(
        completedByA,
        false,
        "an obsolete worker must not be able to complete a job it no longer holds",
      );

      // Worker B, the legitimate current owner, can still complete it normally.
      const completedByB = await markJobDone(admin!, job.id, tokenB);
      assert(completedByB, "the current lease holder must still be able to complete the job");

      const { data: finalRow } = await admin!
        .from("whatsapp_agent_jobs")
        .select("status")
        .eq("id", job.id)
        .single();
      assertEquals(
        finalRow?.status,
        "done",
        "the job must end up 'done' via worker B, not overwritten by obsolete worker A",
      );
    });
  },
});
