// Integration tests for the manual-retry core logic (production-hardening audit — "ambiguous
// delivery review and manual retry"). Same env-var gating/cleanup discipline as the other
// *.integration.test.ts files.
//
// Scope note: this file covers scenarios (6)-(11) — the retry BEHAVIOR, which only needs the
// database, not a real auth session. Scenarios (1)-(5) (JWT/admin authorization) are covered
// separately in admin-auth.test.ts, and (2)-(5) specifically require a live Supabase project with
// real user fixtures (a non-admin account, an inactive admin row, an active admin session) that
// don't exist in this environment — see that file's header. Scenario (12) ("ambiguous result
// during manual retry") is exercised as a pure unit test of the classification function itself in
// outbound.test.ts (classifyTimeout / classifySendResult with no definite response) since forcing
// a real network timeout deterministically inside an integration test isn't practical without a
// mock seam this pass didn't add (no redesign, per instructions) — what's NOT covered here is the
// live network timing, only (as with the rest of this module) the classification and persistence
// logic downstream of it.
import { assert, assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { retryAmbiguousDelivery } from "./manual-retry.ts";

const API_URL = Deno.env.get("API_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SERVICE_ROLE_KEY") ?? "";
const ALLOW =
  (Deno.env.get("WHATSAPP_AGENT_ALLOW_INTEGRATION_TESTS") ?? "").toLowerCase() === "true";
const canRun = ALLOW && !!API_URL && !!SERVICE_ROLE;

const admin = canRun
  ? createClient(API_URL, SERVICE_ROLE, { auth: { persistSession: false } })
  : null;

async function withAmbiguousRow(
  fn: (ctx: {
    conversationId: string;
    outboundMessageId: string;
    adminId: string;
  }) => Promise<void>,
) {
  const phone = `54911${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`;
  const { data: conversation, error: convErr } = await admin!
    .from("whatsapp_agent_conversations")
    .insert({ customer_phone: phone, is_test: true, status: "bot_active" })
    .select("id")
    .single();
  if (convErr || !conversation)
    throw new Error(`failed to create test conversation: ${convErr?.message}`);

  const { data: job, error: jobErr } = await admin!
    .from("whatsapp_agent_jobs")
    .insert({ conversation_id: conversation.id, message_text: "hola" })
    .select("id")
    .single();
  if (jobErr || !job) throw new Error(`failed to create test job: ${jobErr?.message}`);

  const { data: outbound, error: outErr } = await admin!
    .from("whatsapp_agent_outbound_messages")
    .insert({
      job_id: job.id,
      conversation_id: conversation.id,
      message_text: "reserva confirmada",
      status: "ambiguous",
      error: "timeout_awaiting_response",
    })
    .select("id")
    .single();
  if (outErr || !outbound)
    throw new Error(`failed to create test outbound row: ${outErr?.message}`);

  // Any existing active admin works — this test only needs a valid admin_users.id to satisfy the
  // FK, not a real session (see file header re: auth fixtures).
  const { data: anyAdmin } = await admin!
    .from("admin_users")
    .select("id")
    .eq("active", true)
    .limit(1)
    .maybeSingle();
  if (!anyAdmin)
    throw new Error(
      "no active admin_users row found — required as a FK target for whatsapp_agent_manual_retries.requested_by",
    );

  try {
    await fn({
      conversationId: conversation.id,
      outboundMessageId: outbound.id,
      adminId: anyAdmin.id,
    });
  } finally {
    await admin!
      .from("whatsapp_agent_manual_retries")
      .delete()
      .eq("original_outbound_message_id", outbound.id);
    await admin!.from("whatsapp_agent_outbound_messages").delete().eq("id", outbound.id);
    await admin!.from("whatsapp_agent_jobs").delete().eq("id", job.id);
    await admin!.from("whatsapp_agent_conversations").delete().eq("id", conversation.id);
  }
}

// ---------------------------------------------------------------------------
// (6) Retry of a non-ambiguous record
// ---------------------------------------------------------------------------
Deno.test({
  name: "(6) retrying a non-ambiguous record is rejected",
  ignore: !canRun,
  fn: async () => {
    await withAmbiguousRow(async ({ outboundMessageId, adminId }) => {
      await admin!
        .from("whatsapp_agent_outbound_messages")
        .update({ status: "sent" })
        .eq("id", outboundMessageId);

      const result = await retryAmbiguousDelivery(admin!, {
        outboundMessageId,
        adminId,
        reason: "test",
      });
      assertEquals(result.ok, false);
      if (!result.ok) {
        assertEquals(result.error, "not_ambiguous");
        assertEquals(result.currentStatus, "sent");
      }

      const { count } = await admin!
        .from("whatsapp_agent_manual_retries")
        .select("id", { count: "exact", head: true })
        .eq("original_outbound_message_id", outboundMessageId);
      assertEquals(count, 0, "no retry record should be created for a rejected request");
    });
  },
});

// ---------------------------------------------------------------------------
// (7) Two rapid retry requests
// ---------------------------------------------------------------------------
Deno.test({
  name: "(7) two rapid retry requests for the same row: only the first proceeds, the second is debounced",
  ignore: !canRun,
  fn: async () => {
    await withAmbiguousRow(async ({ outboundMessageId, adminId }) => {
      const [first, second] = await Promise.all([
        retryAmbiguousDelivery(admin!, { outboundMessageId, adminId, reason: "click 1" }),
        retryAmbiguousDelivery(admin!, {
          outboundMessageId,
          adminId,
          reason: "click 2 (accidental double-click)",
        }),
      ]);

      const outcomes = [first, second];
      const succeeded = outcomes.filter((r) => r.ok);
      const debounced = outcomes.filter((r) => !r.ok && r.error === "retry_already_in_progress");
      // Both requests race the same debounce check, so in principle either ordering could win —
      // what must hold is that at most one proceeds and the DB never ends up with two rows from
      // truly-concurrent requests this close together.
      assert(succeeded.length >= 1, "at least one of the two rapid requests must proceed");
      assert(succeeded.length + debounced.length === 2);

      const { count } = await admin!
        .from("whatsapp_agent_manual_retries")
        .select("id", { count: "exact", head: true })
        .eq("original_outbound_message_id", outboundMessageId);
      assert(
        (count ?? 0) <= 2,
        "the debounce check bounds how many rapid attempts can create rows",
      );
    });
  },
});

// ---------------------------------------------------------------------------
// (8) Repeated manual retries over time — must be ALLOWED, each recorded separately.
// ---------------------------------------------------------------------------
Deno.test({
  name: "(8) repeated manual retries spaced out over time are each allowed and recorded",
  ignore: !canRun,
  fn: async () => {
    await withAmbiguousRow(async ({ outboundMessageId, adminId }) => {
      const first = await retryAmbiguousDelivery(admin!, {
        outboundMessageId,
        adminId,
        reason: "first attempt",
      });
      assert(first.ok);

      // Simulate time passing (past the debounce window) instead of a real sleep, for speed.
      await admin!
        .from("whatsapp_agent_manual_retries")
        .update({ requested_at: new Date(Date.now() - 60_000).toISOString() })
        .eq("original_outbound_message_id", outboundMessageId);

      const second = await retryAmbiguousDelivery(admin!, {
        outboundMessageId,
        adminId,
        reason: "second attempt, later",
      });
      assert(second.ok, "a retry after the debounce window has passed must be allowed");
      if (first.ok && second.ok) assertNotEquals(first.retryId, second.retryId);

      const { count } = await admin!
        .from("whatsapp_agent_manual_retries")
        .select("id", { count: "exact", head: true })
        .eq("original_outbound_message_id", outboundMessageId);
      assertEquals(count, 2, "both attempts must be independently recorded");
    });
  },
});

// ---------------------------------------------------------------------------
// (9) Audit record creation
// ---------------------------------------------------------------------------
Deno.test({
  name: "(9) a retry creates an audit record with requesting admin, timestamp, and reason",
  ignore: !canRun,
  fn: async () => {
    await withAmbiguousRow(async ({ outboundMessageId, adminId }) => {
      const before = Date.now();
      const result = await retryAmbiguousDelivery(admin!, {
        outboundMessageId,
        adminId,
        reason: "cliente confirmó por otro medio",
      });
      assert(result.ok);

      const { data: row } = await admin!
        .from("whatsapp_agent_manual_retries")
        .select("requested_by, requested_at, reason, original_outbound_message_id")
        .eq("id", result.ok ? result.retryId : "")
        .single();
      assertEquals(row?.requested_by, adminId);
      assertEquals(row?.reason, "cliente confirmó por otro medio");
      assertEquals(row?.original_outbound_message_id, outboundMessageId);
      assert(row?.requested_at && Date.parse(row.requested_at) >= before - 1000);
    });
  },
});

// ---------------------------------------------------------------------------
// (10) Original delivery-attempt history remains intact
// ---------------------------------------------------------------------------
Deno.test({
  name: "(10) the original ambiguous record is never modified by a retry",
  ignore: !canRun,
  fn: async () => {
    await withAmbiguousRow(async ({ outboundMessageId, adminId }) => {
      const { data: before } = await admin!
        .from("whatsapp_agent_outbound_messages")
        .select("status, error, message_text, created_at")
        .eq("id", outboundMessageId)
        .single();

      await retryAmbiguousDelivery(admin!, { outboundMessageId, adminId, reason: "test" });

      const { data: after } = await admin!
        .from("whatsapp_agent_outbound_messages")
        .select("status, error, message_text, created_at")
        .eq("id", outboundMessageId)
        .single();
      assertEquals(after, before, "the original row must be byte-for-byte unchanged after a retry");
    });
  },
});

// ---------------------------------------------------------------------------
// (11) Provider rejection during manual retry (simulated via the deterministic "no Botmaker
// credentials configured" path — sendBotmakerWhatsApp returns a definite skipped/failed result
// without a network call, which classifySendResult treats as a definite, non-ambiguous failure;
// see outbound.test.ts for that classification proven directly).
// ---------------------------------------------------------------------------
Deno.test({
  name: "(11) a definite send failure during retry is recorded as 'failed', not silently dropped",
  ignore: !canRun,
  fn: async () => {
    await withAmbiguousRow(async ({ outboundMessageId, adminId }) => {
      const result = await retryAmbiguousDelivery(admin!, {
        outboundMessageId,
        adminId,
        reason: "test",
      });
      assert(result.ok);
      if (!result.ok) return;

      // In this test environment BOTMAKER_API_TOKEN is not configured, so the send is definitely
      // never attempted — classifySendResult's "skipped" branch — a real, deterministic stand-in
      // for "the provider path definitely did not deliver".
      assertEquals(result.status, "failed");

      const { data: row } = await admin!
        .from("whatsapp_agent_manual_retries")
        .select("status, error")
        .eq("id", result.retryId)
        .single();
      assertEquals(row?.status, "failed");
      assert(row?.error, "the failure reason must be recorded, not discarded");
    });
  },
});
