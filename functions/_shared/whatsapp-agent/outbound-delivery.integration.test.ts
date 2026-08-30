// Integration tests for outbound-delivery retry policy (production-hardening audit — "outbound
// delivery ambiguity", scenarios 5 and 6, which need a persisted ledger row so they can't be pure
// unit tests — see outbound.test.ts for the other 4 scenarios). Same env-var gating/cleanup
// discipline as the other *.integration.test.ts files.
//
// Neither test below ever reaches sendBotmakerWhatsApp (no BOTMAKER_API_TOKEN needed) — both
// 'ambiguous' and 'sent' rows short-circuit in sendAgentReplyOnce before attempting a send, which
// is exactly the behavior under test: proven here by asserting the row is untouched afterward.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { enqueueJob } from "./job-queue.ts";
import { sendAgentReplyOnce } from "./outbound.ts";

const API_URL = Deno.env.get("API_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SERVICE_ROLE_KEY") ?? "";
const ALLOW =
  (Deno.env.get("WHATSAPP_AGENT_ALLOW_INTEGRATION_TESTS") ?? "").toLowerCase() === "true";
const canRun = ALLOW && !!API_URL && !!SERVICE_ROLE;

const admin = canRun
  ? createClient(API_URL, SERVICE_ROLE, { auth: { persistSession: false } })
  : null;

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

Deno.test({
  name: "scenario: retry after ambiguous delivery does NOT resend — row is left untouched",
  ignore: !canRun,
  fn: async () => {
    await withTestJob(async ({ conversationId, jobId }) => {
      const sentinelError = `test_sentinel_${Date.now()}`;
      await admin!.from("whatsapp_agent_outbound_messages").insert({
        job_id: jobId,
        conversation_id: conversationId,
        message_text: "reserva confirmada",
        status: "ambiguous",
        error: sentinelError,
      });

      const result = await sendAgentReplyOnce(admin!, {
        jobId,
        conversationId,
        phone: "5491100000000",
        text: "reserva confirmada",
        dryRun: false,
      });

      assertEquals(result.outcome, "ambiguous");

      const { data: row } = await admin!
        .from("whatsapp_agent_outbound_messages")
        .select("status,error")
        .eq("job_id", jobId)
        .single();
      assertEquals(
        row?.status,
        "ambiguous",
        "must still be ambiguous — never silently promoted to sent/retryable",
      );
      assertEquals(
        row?.error,
        sentinelError,
        "must not have attempted a new send that would overwrite this",
      );
    });
  },
});

Deno.test({
  name: "scenario: retry after confirmed delivery does NOT resend — row is left untouched",
  ignore: !canRun,
  fn: async () => {
    await withTestJob(async ({ conversationId, jobId }) => {
      const sentinelProviderId = `test_provider_id_${Date.now()}`;
      await admin!.from("whatsapp_agent_outbound_messages").insert({
        job_id: jobId,
        conversation_id: conversationId,
        message_text: "reserva confirmada",
        status: "sent",
        provider_message_id: sentinelProviderId,
        sent_at: new Date().toISOString(),
      });

      const result = await sendAgentReplyOnce(admin!, {
        jobId,
        conversationId,
        phone: "5491100000000",
        text: "reserva confirmada",
        dryRun: false,
      });

      assertEquals(result.outcome, "already_sent");

      const { data: row } = await admin!
        .from("whatsapp_agent_outbound_messages")
        .select("status,provider_message_id")
        .eq("job_id", jobId)
        .single();
      assertEquals(row?.status, "sent");
      assertEquals(
        row?.provider_message_id,
        sentinelProviderId,
        "must not have attempted a second send",
      );
    });
  },
});
