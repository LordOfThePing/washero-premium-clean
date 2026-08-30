// @ts-nocheck -- ported verbatim from functions/; not our source of truth for types
// Secure tool endpoints the n8n WhatsApp booking agent calls directly during a conversation
// (the no-Anthropic architecture). n8n owns transport/conversation/intents/state; every business
// fact (services, prices, coverage, availability) and every mutation (booking create/cancel/
// reschedule) still goes through the exact same deterministic, validated tool layer the in-house
// Claude agent used (_shared/whatsapp-agent/tools.ts) — nothing about booking-core.ts,
// coverage.ts, pricing, or capacity/concurrency safety changes. This file is only HTTP plumbing:
// shared-secret auth, strict JSON parsing, dispatch to the right tool, structured JSON back.
//
// Auth: a dedicated shared secret sent under a configurable header (WHATSAPP_TOOLS_SECRET /
// WHATSAPP_TOOLS_SECRET_HEADER, default x-whatsapp-tools-secret), not a Supabase JWT — n8n's
// HTTP Request node can't mint one, same reasoning and same constant-time check as
// whatsapp-agent-worker's x-internal-secret (see _shared/whatsapp-agent/worker-auth.ts). Never
// trust prices/availability the caller might echo back — every tool recomputes them from the
// database; create_booking revalidates capacity atomically inside create_booking_atomic()
// regardless of what the caller believed was available.
import { createClient } from "@supabase/supabase-js";
import { findTool } from "../_shared/whatsapp-agent/tools.ts";
import type { AgentToolContext } from "../_shared/whatsapp-agent/tools.ts";
import { isValidWorkerSecret } from "../_shared/whatsapp-agent/worker-auth.ts";
import { normalizeArgentinaWhatsAppPhone } from "../_shared/whatsapp-outbound.ts";

const TOOLS_SECRET_HEADER = (process.env.WHATSAPP_TOOLS_SECRET_HEADER ?? "x-whatsapp-tools-secret").trim().toLowerCase();

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": `content-type, ${TOOLS_SECRET_HEADER}`,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const API_URL = process.env.API_URL!;
const SERVICE_ROLE = process.env.SERVICE_ROLE_KEY!;
const TOOLS_SECRET = process.env.WHATSAPP_TOOLS_SECRET ?? "";

const admin = createClient(API_URL, SERVICE_ROLE, { auth: { persistSession: false } });

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
  /** Transport that created this conversation, e.g. "cloud_api" (n8n). Recorded on the
   * conversation row so /admin/mensajes can distinguish channels if more than one ever exists. */
  transport?: string;
  args?: Record<string, unknown>;
};

/** Find-or-create the whatsapp_conversations row this call belongs to, so this shows up in the
 * admin inbox (/admin/mensajes) without a separate identity system. Its internal uuid is what
 * request_human_handoff and create_booking's idempotency key key off. */
async function resolveConversationRow(input: {
  externalConversationId: string;
  phone: string;
  name: string | null;
  transport: string;
}): Promise<{ id: string }> {
  const { data: existing } = await admin
    .from("whatsapp_conversations")
    .select("id")
    .eq("external_conversation_id", input.externalConversationId)
    .maybeSingle();
  if (existing) {
    await admin
      .from("whatsapp_conversations")
      .update({ customer_phone: input.phone, customer_name: input.name ?? undefined })
      .eq("id", existing.id);
    return { id: existing.id as string };
  }
  const insertRow: Record<string, unknown> = {
    external_conversation_id: input.externalConversationId,
    customer_phone: input.phone,
    customer_name: input.name,
    channel: "whatsapp",
    transport: input.transport || "cloud_api",
  };

  const res = await admin
    .from("whatsapp_conversations")
    .insert(insertRow)
    .select("id")
    .maybeSingle();
  if (res.error || !res.data)
    throw new Error(`failed to resolve whatsapp_conversations row: ${res.error?.message}`);
  return { id: res.data.id as string };
}

/** Deterministic-flow equivalent of handoff.ts's requestHumanHandoff, minus the
 * whatsapp_agent_conversations bookkeeping that only applies to the in-house-agent architecture.
 * Reopens the assignment if it was previously resolved, same as the existing pattern. */
async function requestHumanHandoffDeterministic(
  conversationRowId: string,
  reason: string,
): Promise<{ ok: true; reason: string }> {
  const note = `[WhatsApp tools] Derivado a humano: ${reason}`;
  const { data: existing } = await admin
    .from("conversation_assignments")
    .select("id,status")
    .eq("conversation_id", conversationRowId)
    .maybeSingle();
  if (existing) {
    await admin
      .from("conversation_assignments")
      .update(existing.status === "resolved" ? { status: "open", notes: note } : { notes: note })
      .eq("id", existing.id);
  } else {
    await admin.from("conversation_assignments").insert({
      conversation_id: conversationRowId,
      status: "open",
      notes: note,
    });
  }
  return { ok: true, reason };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  if (!(await isValidWorkerSecret(req.headers.get(TOOLS_SECRET_HEADER), TOOLS_SECRET))) {
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

  const externalConversationId = String(body.conversation_id ?? "").trim();
  if (!externalConversationId) return json({ ok: false, error: "missing_conversation_id" }, 400);

  try {
    const conversationRow = await resolveConversationRow({
      externalConversationId,
      phone,
      name: body.customer_name?.trim() || null,
      transport: String(body.transport ?? "cloud_api").trim() || "cloud_api",
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
    console.error("[whatsapp-tools] unexpected error", e);
    return json({ ok: false, error: "server_error" }, 500);
  }
});
