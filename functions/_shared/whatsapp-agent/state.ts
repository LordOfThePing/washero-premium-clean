// Conversation state + message transcript persistence for the WhatsApp agent.
// Nothing here calls an LLM or a WhatsApp provider — purely Supabase reads/writes, so the
// orchestrator (which does call the LLM) stays easy to reason about and test.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

export type AgentConversationStatus =
  | "bot_active"
  | "human_requested"
  | "human_active"
  | "bot_paused"
  | "closed";

export type AgentConversationRow = {
  id: string;
  inbox_conversation_id: string | null;
  customer_phone: string;
  customer_id: string | null;
  customer_name: string | null;
  status: AgentConversationStatus;
  draft: Record<string, unknown>;
  booking_id: string | null;
  last_processed_external_message_id: string | null;
  last_activity_at: string;
  is_test: boolean;
  created_at: string;
  updated_at: string;
};

export type AgentMessageRow = {
  id: string;
  conversation_id: string;
  role: "user" | "assistant" | "tool" | "system";
  content: string | null;
  tool_name: string | null;
  tool_input: Record<string, unknown> | null;
  tool_output: Record<string, unknown> | null;
  raw_content: unknown | null;
  external_message_id: string | null;
  job_id: string | null;
  created_at: string;
};

/**
 * Fetches the open (non-closed) conversation for this phone, or creates one. One phone has at
 * most one open agent conversation at a time — a closed one doesn't block a fresh conversation
 * starting later (see whatsapp_agent_conversations_phone_uidx, partial on status <> 'closed').
 */
export async function getOrCreateAgentConversation(
  admin: SupabaseClient,
  opts: {
    customerPhone: string;
    customerName?: string | null;
    inboxConversationId?: string | null;
    isTest?: boolean;
  },
): Promise<AgentConversationRow> {
  const { data: existing } = await admin
    .from("whatsapp_agent_conversations")
    .select("*")
    .eq("customer_phone", opts.customerPhone)
    .neq("status", "closed")
    .maybeSingle();

  if (existing) {
    const patch: Record<string, unknown> = { last_activity_at: new Date().toISOString() };
    if (opts.customerName && opts.customerName !== existing.customer_name)
      patch.customer_name = opts.customerName;
    if (
      opts.inboxConversationId &&
      opts.inboxConversationId !== existing.inbox_conversation_id
    ) {
      patch.inbox_conversation_id = opts.inboxConversationId;
    }
    const { data: updated } = await admin
      .from("whatsapp_agent_conversations")
      .update(patch)
      .eq("id", existing.id)
      .select("*")
      .maybeSingle();
    return (updated ?? existing) as AgentConversationRow;
  }

  // A human may already be handling this conversation inside the admin inbox before the
  // agent ever sees a message for it (production-hardening audit finding #3) — start paused
  // rather than bot_active in that case, instead of racing a reply against an active operator.
  let initialStatus: AgentConversationRow["status"] = "bot_active";
  if (opts.inboxConversationId) {
    const { data: assignment } = await admin
      .from("conversation_assignments")
      .select("status")
      .eq("conversation_id", opts.inboxConversationId)
      .maybeSingle();
    if (assignment && assignment.status !== "resolved") {
      initialStatus = "human_active";
    }
  }

  const { data: created, error } = await admin
    .from("whatsapp_agent_conversations")
    .insert({
      customer_phone: opts.customerPhone,
      customer_name: opts.customerName ?? null,
      inbox_conversation_id: opts.inboxConversationId ?? null,
      is_test: !!opts.isTest,
      status: initialStatus,
    })
    .select("*")
    .maybeSingle();
  if (error || !created)
    throw new Error(`failed to create whatsapp_agent_conversation: ${error?.message}`);
  return created as AgentConversationRow;
}

/** Read-only lookup — never creates a row. Used for signals (e.g. a human took over inside
 * n8n) that should sync an *existing* conversation but must not spin up a new one for a
 * phone number the agent was never tracking in the first place. */
export async function findOpenAgentConversationByPhone(
  admin: SupabaseClient,
  customerPhone: string,
): Promise<AgentConversationRow | null> {
  const { data } = await admin
    .from("whatsapp_agent_conversations")
    .select("*")
    .eq("customer_phone", customerPhone)
    .neq("status", "closed")
    .maybeSingle();
  return (data as AgentConversationRow | null) ?? null;
}

export async function updateConversation(
  admin: SupabaseClient,
  conversationId: string,
  patch: Partial<
    Pick<
      AgentConversationRow,
      | "status"
      | "draft"
      | "booking_id"
      | "customer_id"
      | "customer_name"
      | "last_processed_external_message_id"
    >
  >,
): Promise<void> {
  await admin
    .from("whatsapp_agent_conversations")
    .update({ ...patch, last_activity_at: new Date().toISOString() })
    .eq("id", conversationId);
}

export async function appendMessage(
  admin: SupabaseClient,
  conversationId: string,
  msg: {
    role: AgentMessageRow["role"];
    content?: string | null;
    tool_name?: string | null;
    tool_input?: Record<string, unknown> | null;
    tool_output?: Record<string, unknown> | null;
    raw_content?: unknown | null;
    external_message_id?: string | null;
    job_id?: string | null;
  },
): Promise<void> {
  await admin.from("whatsapp_agent_messages").insert({
    conversation_id: conversationId,
    role: msg.role,
    content: msg.content ?? null,
    tool_name: msg.tool_name ?? null,
    tool_input: msg.tool_input ?? null,
    tool_output: msg.tool_output ?? null,
    raw_content: msg.raw_content ?? null,
    external_message_id: msg.external_message_id ?? null,
    job_id: msg.job_id ?? null,
  });
}

export async function loadRecentMessages(
  admin: SupabaseClient,
  conversationId: string,
  limit = 60,
): Promise<AgentMessageRow[]> {
  const { data } = await admin
    .from("whatsapp_agent_messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(limit);
  return (data ?? []) as AgentMessageRow[];
}

/** Reconstructs the Anthropic Messages API `messages` array from persisted user/assistant rows. */
export function toClaudeMessages(
  rows: AgentMessageRow[],
): Array<{ role: "user" | "assistant"; content: unknown }> {
  return rows
    .filter((r) => (r.role === "user" || r.role === "assistant") && r.raw_content != null)
    .map((r) => ({ role: r.role as "user" | "assistant", content: r.raw_content }));
}

/**
 * Webhook idempotency for the agent pipeline. Returns true (and records the event) only the
 * first time a given (provider, external_message_id) is seen — a unique-constraint race between
 * two concurrent webhook deliveries resolves to exactly one caller getting `true`.
 */
export async function claimWebhookEventOnce(
  admin: SupabaseClient,
  opts: { provider: string; externalMessageId: string; customerPhone?: string | null },
): Promise<boolean> {
  const { error } = await admin.from("whatsapp_agent_processed_events").insert({
    provider: opts.provider,
    external_message_id: opts.externalMessageId,
    customer_phone: opts.customerPhone ?? null,
  });
  if (!error) return true;
  // 23505 = unique_violation — another delivery of the same event already claimed it.
  if ((error as { code?: string }).code === "23505") return false;
  console.error("[whatsapp-agent/state] claimWebhookEventOnce failed", error);
  // Fail open on unexpected DB errors so a transient issue doesn't silently drop messages —
  // duplicate processing is still guarded downstream by the booking idempotency_key.
  return true;
}
