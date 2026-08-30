// @ts-nocheck -- ported verbatim from functions/; not our source of truth for types
// Core logic for manually retrying an ambiguous outbound delivery (production-hardening audit —
// "ambiguous delivery review and manual retry"). Factored out of
// whatsapp-agent-manual-retry/index.ts so it's testable without a live HTTP server or a real
// Supabase auth session — see manual-retry.integration.test.ts. The Edge Function itself only
// adds JWT/admin authentication and HTTP plumbing around this.
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendWhatsAppMessage } from "../whatsapp-outbound.ts";
import { classifySendResult, classifyTimeout } from "./outbound.ts";

const OUTBOUND_SEND_TIMEOUT_MS = 20_000; // matches outbound.ts
export const MANUAL_RETRY_DEBOUNCE_SECONDS = 10; // blocks accidental rapid repeated clicks

class SendTimeoutError extends Error {}

function withSendTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new SendTimeoutError("outbound_send_timeout")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId)) as Promise<T>;
}

export type ManualRetryOutcome =
  | { ok: true; retryId: string; outcome: string; status: string }
  | {
      ok: false;
      error:
        | "not_found"
        | "not_ambiguous"
        | "retry_already_in_progress"
        | "conversation_not_found"
        | "server_error";
      currentStatus?: string;
    };

/**
 * Retries exactly one AMBIGUOUS outbound row. Never touches the original row (creates a new
 * whatsapp_agent_manual_retries row instead — see that migration's header), never reruns the
 * agent turn, never recreates a booking, and is debounced against rapid repeated calls for the
 * same row.
 */
export async function retryAmbiguousDelivery(
  admin: SupabaseClient,
  opts: { outboundMessageId: string; adminId: string; reason: string },
): Promise<ManualRetryOutcome> {
  const { data: original } = await admin
    .from("whatsapp_agent_outbound_messages")
    .select("id, conversation_id, message_text, status")
    .eq("id", opts.outboundMessageId)
    .maybeSingle();
  if (!original) return { ok: false, error: "not_found" };

  if (original.status !== "ambiguous") {
    return { ok: false, error: "not_ambiguous", currentStatus: original.status };
  }

  const since = new Date(Date.now() - MANUAL_RETRY_DEBOUNCE_SECONDS * 1000).toISOString();
  const { count: recentCount } = await admin
    .from("whatsapp_agent_manual_retries")
    .select("id", { count: "exact", head: true })
    .eq("original_outbound_message_id", opts.outboundMessageId)
    .gte("requested_at", since);
  if ((recentCount ?? 0) > 0) {
    return { ok: false, error: "retry_already_in_progress" };
  }

  const { data: conversation } = await admin
    .from("whatsapp_agent_conversations")
    .select("customer_phone, customer_name, booking_id")
    .eq("id", original.conversation_id)
    .maybeSingle();
  if (!conversation) return { ok: false, error: "conversation_not_found" };

  const { data: retryRow, error: insertErr } = await admin
    .from("whatsapp_agent_manual_retries")
    .insert({
      original_outbound_message_id: opts.outboundMessageId,
      conversation_id: original.conversation_id,
      message_text: original.message_text,
      status: "sending",
      requested_by: opts.adminId,
      reason: opts.reason,
    })
    .select("id")
    .single();
  if (insertErr || !retryRow) {
    console.error("[whatsapp-agent/manual-retry] failed to create retry record", insertErr);
    return { ok: false, error: "server_error" };
  }

  let classification: {
    dbStatus: "sent" | "retryable" | "ambiguous";
    outcome: string;
    error: string | null;
  };
  let providerMessageId: string | null = null;
  try {
    const result = await withSendTimeout(
      sendWhatsAppMessage(admin, {
        phone: conversation.customer_phone,
        kind: "text",
        text: original.message_text,
        customerName: conversation.customer_name ?? undefined,
        bookingId: conversation.booking_id ?? undefined,
      }),
      OUTBOUND_SEND_TIMEOUT_MS,
    );
    classification = classifySendResult(result);
    providerMessageId = result.provider_message_id ?? null;
  } catch (e) {
    classification =
      e instanceof SendTimeoutError
        ? classifyTimeout()
        : {
            dbStatus: "ambiguous",
            outcome: "ambiguous",
            error: String((e as Error)?.message ?? e),
          };
  }

  const finalStatus = classification.dbStatus === "retryable" ? "failed" : classification.dbStatus;
  const update: Record<string, unknown> = { status: finalStatus, error: classification.error };
  if (classification.dbStatus === "sent") {
    update.provider_message_id = providerMessageId;
    update.sent_at = new Date().toISOString();
    update.error = null;
  }
  await admin.from("whatsapp_agent_manual_retries").update(update).eq("id", retryRow.id);

  return { ok: true, retryId: retryRow.id, outcome: classification.outcome, status: finalStatus };
}
