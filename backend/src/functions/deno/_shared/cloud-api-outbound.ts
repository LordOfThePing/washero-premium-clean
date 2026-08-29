// @ts-nocheck -- ported verbatim from supabase/functions; not our source of truth for types
// WhatsApp Cloud API transport module — SUPERSEDED in the outbound direction.
//
// HISTORY: this file previously (draft) shipped sendCloudWhatsApp() /
// sendCloudTemplateMessage(), which POSTed directly to graph.facebook.com using
// WHATSAPP_CLOUD_API_TOKEN. That made Supabase hold Meta credentials, so outbound
// was moved (2026) to route through the n8n "WhatsApp Outbound Gateway" webhook
// instead — see _shared/whatsapp-automation.ts (sendViaN8nGateway). The direct
// Graph senders were deleted; what remains are the shared transport helpers that
// whatsapp-automation.ts still imports (channel-only dedupe, types, redaction).
//
// SECURITY: NEVER re-add WHATSAPP_CLOUD_API_TOKEN / WHATSAPP_CLOUD_PHONE_NUMBER_ID
// as Supabase secrets. All Meta/WhatsApp credentials live in n8n only.
import type { SupabaseClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Shared types (kept for parity with botmaker-outbound and whatsapp-automation).
// ---------------------------------------------------------------------------
export type OutboundLogStatus = "pending" | "sent" | "failed" | "skipped";

export type SendCloudMessageResult = {
  ok: boolean;
  status: OutboundLogStatus;
  provider_message_id?: string | null;
  error?: string | null;
  log_id?: string | null;
};

// ---------------------------------------------------------------------------
// Secret redaction — never log the deprecated cloud token (usually empty) or any
// header carrying a secret value by key name.
// ---------------------------------------------------------------------------
const SENSITIVE_KEY = /^(access[-_]?token|authorization|api[-_]?key|x-api-key|token|secret|password|bearer)$/i;

/** Strip the (deprecated) cloud access token anywhere it appears in logged values. */
export function sanitizeForLog(value: unknown): unknown {
  const token = process.env.WHATSAPP_CLOUD_API_TOKEN ?? "";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return token ? value.split(token).join("[REDACTED]") : value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map(sanitizeForLog);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY.test(k)) out[k] = "[REDACTED]";
      else out[k] = sanitizeForLog(v);
    }
    return out;
  }
  return String(value);
}

/**
 * Duplicate guard for templates. Provider-agnostic (channel-only) so a confirmation
 * does not fire twice across transports/rollback. Kept here and reused by
 * whatsapp-automation.ts's hasOutboundTemplateLogAny().
 */
export async function hasOutboundTemplateLogChannelOnly(
  admin: SupabaseClient,
  bookingId: string,
  templateKey: string,
  sinceIso?: string,
): Promise<boolean> {
  let q = admin
    .from("communication_logs")
    .select("id, raw_payload, created_at")
    .eq("booking_id", bookingId)
    .eq("channel", "whatsapp")
    .eq("direction", "outbound")
    .order("created_at", { ascending: false })
    .limit(20);
  if (sinceIso) q = q.gte("created_at", sinceIso);
  const { data, error } = await q;
  if (error) {
    console.warn("[whatsapp-outbound] duplicate check failed", error);
    return false;
  }
  return (data ?? []).some((row) => {
    const p = row.raw_payload as Record<string, unknown> | null;
    const status = p?.status;
    const okStatus = status === "sent" || status === "pending" || status === "accepted";
    return p?.template_key === templateKey && okStatus;
  });
}
