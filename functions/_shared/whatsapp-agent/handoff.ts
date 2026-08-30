// Human handoff state machine for the WhatsApp agent.
//
// Reuses the existing conversation_assignments table (the same one /admin/mensajes already
// surfaces) so a human handoff from the agent shows up in the operator/admin UI operators
// already use — no separate handoff queue.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import type { AgentConversationRow, AgentConversationStatus } from "./state.ts";

/** The bot only auto-replies in this state. Every other state means "stay quiet". */
export function botShouldRespond(status: AgentConversationStatus): boolean {
  return status === "bot_active";
}

export async function requestHumanHandoff(
  admin: SupabaseClient,
  conversation: AgentConversationRow,
  reason: string,
): Promise<void> {
  await admin
    .from("whatsapp_agent_conversations")
    .update({ status: "human_requested", last_activity_at: new Date().toISOString() })
    .eq("id", conversation.id);

  if (!conversation.inbox_conversation_id) {
    console.warn(
      "[whatsapp-agent/handoff] no inbox_conversation_id to link — handoff recorded on agent conversation only",
      {
        conversation_id: conversation.id,
        reason,
      },
    );
    return;
  }

  const { data: existing } = await admin
    .from("conversation_assignments")
    .select("id,status,notes")
    .eq("conversation_id", conversation.inbox_conversation_id)
    .maybeSingle();

  const note = `[Agente WhatsApp] Derivado a humano: ${reason}`;
  if (existing) {
    if (existing.status === "resolved") {
      await admin
        .from("conversation_assignments")
        .update({ status: "open", notes: note })
        .eq("id", existing.id);
    } else {
      await admin.from("conversation_assignments").update({ notes: note }).eq("id", existing.id);
    }
  } else {
    await admin.from("conversation_assignments").insert({
      conversation_id: conversation.inbox_conversation_id,
      status: "open",
      notes: note,
    });
  }
}

/** Admin/operator action: hand the conversation back to the bot. */
export async function returnConversationToBot(
  admin: SupabaseClient,
  conversationId: string,
): Promise<void> {
  await admin
    .from("whatsapp_agent_conversations")
    .update({ status: "bot_active", last_activity_at: new Date().toISOString() })
    .eq("id", conversationId);
}

/** Admin/operator action: take manual control (bot stops responding, no further auto-replies). */
export async function takeOverConversation(
  admin: SupabaseClient,
  conversationId: string,
): Promise<void> {
  await admin
    .from("whatsapp_agent_conversations")
    .update({ status: "human_active", last_activity_at: new Date().toISOString() })
    .eq("id", conversationId);
}

export async function closeConversation(
  admin: SupabaseClient,
  conversationId: string,
): Promise<void> {
  await admin
    .from("whatsapp_agent_conversations")
    .update({ status: "closed", last_activity_at: new Date().toISOString() })
    .eq("id", conversationId);
}
