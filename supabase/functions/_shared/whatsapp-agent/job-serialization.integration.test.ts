// Integration test for per-conversation serialization (production-hardening audit finding #2).
// Same env-var gating and cleanup discipline as booking-concurrency.integration.test.ts — see
// that file's header for how to run this.
//
// Scenario: two different inbound messages for the SAME conversation arrive close enough
// together that both jobs are 'pending' at once. Two workers (simulated here as two concurrent
// claim_next_whatsapp_agent_job calls) race to pick up work. Only one may ever be 'processing'
// for that conversation at a time — this is what actually prevents stale reads, lost updates,
// out-of-order replies, and two simultaneous booking confirmations for the same customer.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { claimNextJob, enqueueJob, markJobDone } from "./job-queue.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ALLOW =
  (Deno.env.get("WHATSAPP_AGENT_ALLOW_INTEGRATION_TESTS") ?? "").toLowerCase() === "true";
const canRun = ALLOW && !!SUPABASE_URL && !!SERVICE_ROLE;

const admin = canRun
  ? createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } })
  : null;

function uniqueSuffix() {
  return `${Deno.pid}_${Math.floor(performance.now() * 1000)}`;
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
  name: "claim_next_whatsapp_agent_job: two concurrent claims for the same conversation's two pending jobs — only one is claimed",
  ignore: !canRun,
  fn: async () => {
    await withTestConversation(async (conversationId) => {
      const jobA = await enqueueJob(admin!, {
        conversationId,
        messageText: `mensaje uno ${uniqueSuffix()}`,
      });
      const jobB = await enqueueJob(admin!, {
        conversationId,
        messageText: `mensaje dos ${uniqueSuffix()}`,
      });

      // Simulates two workers (e.g. the webhook's own waitUntil call and the periodic sweep)
      // both trying to pick up work at the same instant.
      const [claim1, claim2] = await Promise.all([claimNextJob(admin!), claimNextJob(admin!)]);

      const claimed = [claim1, claim2].filter((c) => c !== null);
      assertEquals(
        claimed.length,
        1,
        `expected exactly one concurrent claim to succeed, got ${claimed.length}`,
      );
      assert(
        claimed[0]!.id === jobA.id || claimed[0]!.id === jobB.id,
        "the claimed job must be one of this conversation's two jobs",
      );

      // The other job must still be 'pending' — not claimed, not corrupted into some other state.
      const { data: jobs } = await admin!
        .from("whatsapp_agent_jobs")
        .select("id,status")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true });
      const statuses = (jobs ?? []).map((j) => j.status);
      assertEquals(statuses.filter((s) => s === "processing").length, 1);
      assertEquals(statuses.filter((s) => s === "pending").length, 1);

      // Once the in-flight job finishes, the second one becomes claimable — proves messages are
      // processed one at a time, in order, rather than the second one being starved forever.
      await markJobDone(admin!, claimed[0]!.id, claimed[0]!.lease_token!);
      const claim3 = await claimNextJob(admin!);
      assert(claim3 !== null, "the second job should become claimable once the first is done");
      const remainingId = claimed[0]!.id === jobA.id ? jobB.id : jobA.id;
      assertEquals(claim3!.id, remainingId);
      await markJobDone(admin!, claim3!.id, claim3!.lease_token!);
    });
  },
});

Deno.test({
  name: "claim_next_whatsapp_agent_job: jobs from different conversations can be claimed concurrently (no unnecessary cross-conversation serialization)",
  ignore: !canRun,
  fn: async () => {
    await withTestConversation(async (conversationIdA) => {
      await withTestConversation(async (conversationIdB) => {
        const jobA = await enqueueJob(admin!, {
          conversationId: conversationIdA,
          messageText: "hola",
        });
        const jobB = await enqueueJob(admin!, {
          conversationId: conversationIdB,
          messageText: "hola",
        });

        const [claim1, claim2] = await Promise.all([claimNextJob(admin!), claimNextJob(admin!)]);
        assert(
          claim1 !== null && claim2 !== null,
          "both independent conversations' jobs should be claimable concurrently",
        );
        const claimedIds = [claim1!.id, claim2!.id].sort();
        assertEquals(
          claimedIds,
          [jobA.id, jobB.id].sort(),
          "independent conversations should both get claimed, not serialized against each other",
        );

        await markJobDone(admin!, claim1!.id, claim1!.lease_token!);
        await markJobDone(admin!, claim2!.id, claim2!.lease_token!);
      });
    });
  },
});
