// Integration tests for the worker sweep's job-processing mechanics (production-hardening audit —
// "worker authentication and scheduling", scenarios 5-8; scenarios 1-4, the secret-header checks,
// are pure unit tests in worker-auth.test.ts). Same env-var gating/cleanup discipline as the other
// *.integration.test.ts files.
//
// These run the REAL job pipeline (runJobProcessingLoop -> processOneJob -> runAgentTurn) without
// live ANTHROPIC_API_KEY/BOTMAKER_API_TOKEN credentials in this environment — that's fine for what
// is being proven here (queue/claim/completion mechanics, not agent reply quality):
// runAgentTurn degrades gracefully (human handoff + fallback message) when Anthropic is
// unreachable, and the job still reaches a terminal status either way. What's NOT exercised here
// is a real Claude conversation or a real Botmaker send — see the other integration test files and
// the hardening report for what still needs a real end-to-end run with real credentials.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { enqueueJob } from "./job-queue.ts";
import { runJobProcessingLoop } from "./job-processor.ts";

const API_URL = Deno.env.get("API_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SERVICE_ROLE_KEY") ?? "";
const ALLOW =
  (Deno.env.get("WHATSAPP_AGENT_ALLOW_INTEGRATION_TESTS") ?? "").toLowerCase() === "true";
const canRun = ALLOW && !!API_URL && !!SERVICE_ROLE;

const admin = canRun
  ? createClient(API_URL, SERVICE_ROLE, { auth: { persistSession: false } })
  : null;

async function createTestConversation() {
  const phone = `54911${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`;
  const { data, error } = await admin!
    .from("whatsapp_agent_conversations")
    .insert({ customer_phone: phone, is_test: true, status: "bot_active" })
    .select("id")
    .single();
  if (error || !data) throw new Error(`failed to create test conversation: ${error?.message}`);
  return data.id as string;
}

async function cleanupConversation(conversationId: string) {
  await admin!
    .from("whatsapp_agent_outbound_messages")
    .delete()
    .in(
      "job_id",
      (
        await admin!.from("whatsapp_agent_jobs").select("id").eq("conversation_id", conversationId)
      ).data?.map((r) => r.id) ?? [],
    );
  await admin!.from("whatsapp_agent_jobs").delete().eq("conversation_id", conversationId);
  await admin!.from("whatsapp_agent_conversations").delete().eq("id", conversationId);
}

// ---------------------------------------------------------------------------
// (6) No pending jobs
// ---------------------------------------------------------------------------
Deno.test({
  name: "(6) no pending jobs: the loop processes zero and returns cleanly, no error",
  ignore: !canRun,
  fn: async () => {
    const processed = await runJobProcessingLoop(admin!, { maxJobs: 5 });
    assertEquals(typeof processed, "number");
    assert(processed >= 0);
  },
});

// ---------------------------------------------------------------------------
// (5) Two overlapping worker invocations
// ---------------------------------------------------------------------------
Deno.test({
  name: "(5) two overlapping worker sweeps process disjoint jobs, none processed twice",
  ignore: !canRun,
  fn: async () => {
    const conversationIds = await Promise.all([
      createTestConversation(),
      createTestConversation(),
      createTestConversation(),
      createTestConversation(),
    ]);
    try {
      const jobs = await Promise.all(
        conversationIds.map((id) =>
          enqueueJob(admin!, { conversationId: id, messageText: "hola" }),
        ),
      );

      const [processedA, processedB] = await Promise.all([
        runJobProcessingLoop(admin!, { maxJobs: 10 }),
        runJobProcessingLoop(admin!, { maxJobs: 10 }),
      ]);

      assertEquals(
        processedA + processedB,
        jobs.length,
        "combined, the two overlapping sweeps must process each job exactly once",
      );

      const { data: finalJobs } = await admin!
        .from("whatsapp_agent_jobs")
        .select("id,status,attempts")
        .in(
          "id",
          jobs.map((j) => j.id),
        );
      for (const job of finalJobs ?? []) {
        assertEquals(
          job.attempts,
          1,
          `job ${job.id} must have been claimed exactly once, not double-processed`,
        );
        assert(["done", "pending", "failed", "dead"].includes(job.status));
      }
    } finally {
      await Promise.all(conversationIds.map((id) => cleanupConversation(id)));
    }
  },
});

// ---------------------------------------------------------------------------
// (7) Maximum jobs-per-run enforcement
// ---------------------------------------------------------------------------
Deno.test({
  name: "(7) maxJobs caps how many jobs a single sweep call processes",
  ignore: !canRun,
  fn: async () => {
    const conversationIds = await Promise.all(
      Array.from({ length: 5 }, () => createTestConversation()),
    );
    try {
      const jobs = await Promise.all(
        conversationIds.map((id) =>
          enqueueJob(admin!, { conversationId: id, messageText: "hola" }),
        ),
      );

      const processed = await runJobProcessingLoop(admin!, { maxJobs: 2 });
      assertEquals(processed, 2, "the loop must stop at maxJobs even though more jobs are pending");

      const { count: stillPending } = await admin!
        .from("whatsapp_agent_jobs")
        .select("id", { count: "exact", head: true })
        .in(
          "id",
          jobs.map((j) => j.id),
        )
        .eq("status", "pending");
      assertEquals(
        stillPending,
        3,
        "the remaining jobs must be untouched, left for a future sweep",
      );

      // Drain the rest so cleanup doesn't leave dangling processing state.
      await runJobProcessingLoop(admin!, { maxJobs: 10 });
    } finally {
      await Promise.all(conversationIds.map((id) => cleanupConversation(id)));
    }
  },
});

// ---------------------------------------------------------------------------
// (8) Dead-job handling
// ---------------------------------------------------------------------------
Deno.test({
  name: "(8) a job that keeps failing is eventually marked 'dead' instead of retried forever",
  ignore: !canRun,
  fn: async () => {
    const conversationId = await createTestConversation();
    try {
      // A conversation_id that gets deleted out from under the job forces processOneJob's
      // "conversation_not_found" failure path deterministically, every attempt.
      const job = await enqueueJob(admin!, { conversationId, messageText: "hola" });
      await admin!.from("whatsapp_agent_conversations").delete().eq("id", conversationId);

      let lastStatus = "pending";
      for (let i = 0; i < 6; i++) {
        await runJobProcessingLoop(admin!, { maxJobs: 1 });
        const { data: row } = await admin!
          .from("whatsapp_agent_jobs")
          .select("status,attempts")
          .eq("id", job.id)
          .single();
        lastStatus = row?.status ?? "unknown";
        if (lastStatus === "dead") break;
      }
      assertEquals(
        lastStatus,
        "dead",
        "a job that fails every attempt must eventually stop being retried",
      );

      const { data: finalRow } = await admin!
        .from("whatsapp_agent_jobs")
        .select("last_error")
        .eq("id", job.id)
        .single();
      assert(finalRow?.last_error, "the failure reason must be persisted for admin visibility");

      await admin!.from("whatsapp_agent_jobs").delete().eq("id", job.id);
    } finally {
      // Conversation already deleted mid-test; nothing else to clean up.
    }
  },
});
