// Secure tool endpoints Botmaker's own flow (or its generative-AI-with-tools feature, if the
// account plan includes it) calls directly during a conversation — the no-Anthropic architecture.
// Botmaker keeps owning transport/conversation/intents/state; every business fact (services,
// prices, coverage, availability) and every mutation (booking create/cancel/reschedule) still
// goes through the exact same deterministic, validated tool layer the in-house Claude agent used
// (_shared/whatsapp-agent/tools.ts) — nothing about booking-core.ts, coverage.ts, pricing, or
// capacity/concurrency safety changes. This file is only new HTTP plumbing: shared-secret auth,
// strict JSON parsing, dispatch to the right tool, structured JSON back.
//
// Auth: a dedicated shared secret (x-botmaker-tools-secret), not a Supabase JWT — Botmaker's flow
// "API action" / webhook step can't mint one, same reasoning and same constant-time check as
// whatsapp-agent-worker's x-internal-secret (see _shared/whatsapp-agent/worker-auth.ts). Never
// trust prices/availability the flow might echo back — every tool recomputes them from the
// database; create_booking revalidates capacity atomically inside create_booking_atomic()
// regardless of what the flow believed was available.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { findTool } from "../_shared/whatsapp-agent/tools.ts";
import type { AgentToolContext } from "../_shared/whatsapp-agent/tools.ts";
import { isValidWorkerSecret } from "../_shared/whatsapp-agent/worker-auth.ts";
import { normalizeArgentinaWhatsAppPhone } from "../_shared/botmaker-outbound.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-botmaker-tools-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TOOLS_SECRET = Deno.env.get("BOTMAKER_TOOLS_SECRET") ?? "";

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type Payload = {
  tool?: string;
  customer_phone?: string;
  conversation_id?: string;
  customer_name?: string;
  is_test?: boolean;
  /** Transport source: "botmaker" (default/legacy) | "cloud_api" (n8n). Recorded on the
   * conversation row so /admin/mensajes can distinguish channels during the cutover. */
  transport?: string;
  args?: Record<string, unknown>;
};

/** Find-or-create the botmaker_conversations row this call belongs to — the same table/shape the
 * legacy webhook flow already uses, so this new architecture shows up in the same admin inbox
 * (/admin/mensajes) without a separate identity system. Its internal uuid is what
 * request_human_handoff and create_booking's idempotency key key off. */
async function resolveConversationRow(input: {
  botmakerConversationId: string;
  phone: string;
  name: string | null;
  transport: string;
}): Promise<{ id: string }> {
  const { data: existing } = await admin
    .from("botmaker_conversations")
    .select("id")
    .eq("botmaker_conversation_id", input.botmakerConversationId)
    .maybeSingle();
  if (existing) {
    await admin
      .from("botmaker_conversations")
      .update({ customer_phone: input.phone, customer_name: input.name ?? undefined })
      .eq("id", existing.id);
    return { id: existing.id as string };
  }
  const insertRow: Record<string, unknown> = {
    botmaker_conversation_id: input.botmakerConversationId,
    customer_phone: input.phone,
    customer_name: input.name,
    channel: "whatsapp",
  };
  // Optional transport tag — requires the migration that adds botmaker_conversations.transport.
  // If it isn't applied yet, fall back to inserting without it so the endpoint keeps working
  // during rollout instead of failing every call.
  if (input.transport) insertRow.transport = input.transport;

  let res = await admin
    .from("botmaker_conversations")
    .insert(insertRow)
    .select("id")
    .maybeSingle();
  if (res.error && input.transport) {
    const msg = (res.error.message ?? "").toLowerCase();
    if (msg.includes("transport") || msg.includes("does not exist") || msg.includes("column")) {
      const fallbackRow: Record<string, unknown> = { ...insertRow };
      delete fallbackRow.transport;
      res = await admin
        .from("botmaker_conversations")
        .insert(fallbackRow)
        .select("id")
        .maybeSingle();
    }
  }
  if (res.error || !res.data)
    throw new Error(`failed to resolve botmaker_conversations row: ${res.error?.message}`);
  return { id: res.data.id as string };
}

/** Deterministic-flow equivalent of handoff.ts's requestHumanHandoff, minus the
 * whatsapp_agent_conversations bookkeeping that only applies to the in-house-agent architecture.
 * Reopens the assignment if it was previously resolved, same as the existing pattern. */
async function requestHumanHandoffDeterministic(
  conversationRowId: string,
  reason: string,
): Promise<{ ok: true; reason: string }> {
  const note = `[Botmaker tools] Derivado a humano: ${reason}`;
  const { data: existing } = await admin
    .from("conversation_assignments")
    .select("id,status")
    .eq("botmaker_conversation_id", conversationRowId)
    .maybeSingle();
  if (existing) {
    await admin
      .from("conversation_assignments")
      .update(existing.status === "resolved" ? { status: "open", notes: note } : { notes: note })
      .eq("id", existing.id);
  } else {
    await admin.from("conversation_assignments").insert({
      botmaker_conversation_id: conversationRowId,
      status: "open",
      notes: note,
    });
  }
  return { ok: true, reason };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  if (!(await isValidWorkerSecret(req.headers.get("x-botmaker-tools-secret"), TOOLS_SECRET))) {
    return json({ ok: false, error: "Unauthorized" }, 401);
  }

  let body: Payload;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  const toolName = String(body.tool ?? "").trim();
  if (!toolName) return json({ ok: false, error: "missing_tool" }, 400);

  const tool = findTool(toolName);
  if (!tool) return json({ ok: false, error: "unknown_tool", tool: toolName }, 400);

  const phone = normalizeArgentinaWhatsAppPhone(body.customer_phone ?? null);
  if (!phone) return json({ ok: false, error: "invalid_customer_phone" }, 400);

  const botmakerConversationId = String(body.conversation_id ?? "").trim();
  if (!botmakerConversationId) return json({ ok: false, error: "missing_conversation_id" }, 400);

  try {
    const conversationRow = await resolveConversationRow({
      botmakerConversationId,
      phone,
      name: body.customer_name?.trim() || null,
      transport: String(body.transport ?? "botmaker").trim() || "botmaker",
    });

    if (toolName === "request_human_handoff") {
      const reason = String(body.args?.reason ?? "").trim() || "not_specified";
      const result = await requestHumanHandoffDeterministic(conversationRow.id, reason);
      return json(result, 200);
    }

    const ctx: AgentToolContext = {
      conversationId: conversationRow.id,
      customerPhone: phone,
      isTest: !!body.is_test,
      dryRun: false,
    };
    const result = await tool.execute(admin, body.args ?? {}, ctx);
    return json(result, 200);
  } catch (e) {
    console.error("[botmaker-tools] unexpected error", e);
    return json({ ok: false, error: "server_error" }, 500);
  }
});
