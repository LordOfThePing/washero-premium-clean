// @ts-nocheck -- ported verbatim from supabase/functions; not our source of truth for types
// Glue between the Botmaker webhook (transport) and the agent (brain).
//
// Production-hardening audit finding #1: this used to run the whole agent turn synchronously and
// hold the webhook's HTTP response open for it. It now only claims the event, syncs conversation
// state, and enqueues a job — then kicks off processing via EdgeRuntime.waitUntil() (Supabase's
// documented "keep working after the response is sent" mechanism) so the webhook can return
// immediately. waitUntil is best-effort (an instance recycle can still interrupt it); the
// whatsapp-agent-worker periodic sweep is the durable fallback that guarantees every enqueued job
// eventually gets processed or explicitly marked dead — see job-queue.ts / job-processor.ts.
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  claimWebhookEventOnce,
  findOpenAgentConversationByPhone,
  getOrCreateAgentConversation,
} from "./state.ts";
import { botShouldRespond, takeOverConversation } from "./handoff.ts";
import { enqueueJob } from "./job-queue.ts";
import { runJobProcessingLoop } from "./job-processor.ts";
import { normalizeArgentinaWhatsAppPhone } from "../botmaker-outbound.ts";

// Supabase Edge Runtime global for background work after the response is returned. Not part of
// the standard Deno lib types, so it's declared here; guarded at the call site in case this ever
// runs somewhere that doesn't provide it (e.g. an older local `supabase functions serve`).
declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined;

function scheduleBackgroundProcessing(admin: SupabaseClient): void {
  const task = runJobProcessingLoop(admin, { maxJobs: 3 }).catch((e) => {
    console.error("[whatsapp-agent/webhook-handler] background job loop failed", e);
  });
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
    EdgeRuntime.waitUntil(task);
  } else {
    // No supported background-task API available in this runtime. The job row is already
    // durably persisted as 'pending', so the periodic worker sweep will still pick it up — this
    // path only means the fast, same-request-cycle attempt is skipped, not that the message is
    // lost. Logged loudly because it should never happen in the deployed Supabase runtime.
    console.warn(
      "[whatsapp-agent/webhook-handler] EdgeRuntime.waitUntil unavailable — relying on the worker sweep only",
    );
  }
}

export type WhatsappAgentInboundInput = {
  phone: string;
  name: string | null;
  messageText: string;
  externalMessageId: string | null;
  /** whatsapp_agent_conversations.botmaker_conversation_id — the internal uuid, not Botmaker's own conversation id. */
  botmakerConversationId: string | null;
  isTest?: boolean;
  dryRun?: boolean;
};

export type WhatsappAgentInboundResult = { handled: boolean; skipped_reason?: string };

/** A real customer message, from a phone the agent is configured to handle — enqueue a job. */
export async function handleWhatsappAgentInbound(
  admin: SupabaseClient,
  opts: WhatsappAgentInboundInput,
): Promise<WhatsappAgentInboundResult> {
  const normalizedPhone = normalizeArgentinaWhatsAppPhone(opts.phone);
  if (!normalizedPhone) return { handled: false, skipped_reason: "invalid_phone" };
  if (!opts.messageText) return { handled: false, skipped_reason: "empty_message" };

  if (opts.externalMessageId) {
    const claimed = await claimWebhookEventOnce(admin, {
      provider: "botmaker",
      externalMessageId: opts.externalMessageId,
      customerPhone: normalizedPhone,
    });
    if (!claimed) {
      console.info("[whatsapp-agent] duplicate webhook event, skipping", {
        external_message_id: opts.externalMessageId,
      });
      return { handled: false, skipped_reason: "duplicate_event" };
    }
  }

  const conversation = await getOrCreateAgentConversation(admin, {
    customerPhone: normalizedPhone,
    customerName: opts.name,
    botmakerConversationId: opts.botmakerConversationId,
    isTest: opts.isTest,
  });

  if (!botShouldRespond(conversation.status)) {
    console.info("[whatsapp-agent] bot not active, skipping enqueue", {
      conversation_id: conversation.id,
      status: conversation.status,
    });
    return { handled: false, skipped_reason: `status_${conversation.status}` };
  }

  await enqueueJob(admin, {
    conversationId: conversation.id,
    messageText: opts.messageText,
    externalMessageId: opts.externalMessageId,
    source: "webhook",
    dryRun: !!opts.dryRun,
  });

  scheduleBackgroundProcessing(admin);

  return { handled: true };
}

/**
 * Production-hardening audit finding #3: Botmaker tags outbound-from-a-human messages with a
 * sender type our extractSenderType() already classifies as "agent" (operator/human). Treat that
 * as an authoritative live signal that a human is in control right now — call this for every
 * inbound webhook event with senderType "agent", regardless of whether the phone is currently
 * agent-eligible. Deliberately read-only-lookup, never creates a conversation: a human replying
 * to a customer the agent was never tracking is not something we need to record.
 */
export async function syncHumanTakeoverSignal(admin: SupabaseClient, phone: string): Promise<void> {
  const normalizedPhone = normalizeArgentinaWhatsAppPhone(phone);
  if (!normalizedPhone) return;
  const conversation = await findOpenAgentConversationByPhone(admin, normalizedPhone);
  if (!conversation || conversation.status === "human_active") return;
  await takeOverConversation(admin, conversation.id);
  console.info(
    "[whatsapp-agent] Botmaker-side human reply detected — pausing bot for this conversation",
    {
      conversation_id: conversation.id,
    },
  );
}
