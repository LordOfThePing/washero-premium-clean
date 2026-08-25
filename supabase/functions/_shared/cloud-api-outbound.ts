// DRAFT — WhatsApp Cloud API outbound module (transport-only swap).
//
// PURPOSE
//   Replace Botmaker as the WhatsApp *transport* for Washero lifecycle + operator messages,
//   while keeping the same function signatures the rest of the codebase already uses, so the
//   switch is a drop-in at the call sites (see whatsapp-automation.ts WASHERO_TRANSPORT toggle).
//
// STATUS: PREPARATION ARTIFACT on feature branch `feat/n8n-whatsapp-cloudapi-cutover`.
//   NOT deployed. Modeled closely on `_shared/botmaker-outbound.ts` (same phone normalization,
//   same `communication_logs` + dedupe, same never-throw + log pattern, same secret redaction)
//   so reviewers can diff the two easily.
//
// This module is the recommended mechanism (A) in docs/n8n-whatsapp-cloudapi-cutover.md §5.2:
// lifecycle + operator messages go through a dedicated Cloud API outbound so confirmed/reminder/
// payment-receipt sends are robust and independent of the n8n agent. Interactive agent replies
// are owned by the n8n workflow's WhatsApp nodes.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { normalizeArgentinaWhatsAppPhone } from "./botmaker-outbound.ts";

// ---------------------------------------------------------------------------
// Reuse the exact shapes/types Botmaker outbound uses so swapping is mechanical.
// ---------------------------------------------------------------------------
export type OutboundLogStatus = "pending" | "sent" | "failed" | "skipped";

export type SendCloudMessageInput = {
  phone: string;
  message: string;
  customer_name?: string | null;
  booking_id?: string | null;
  invoice_id?: string | null;
  template_key?: string | null;
};

export type SendCloudTemplateInput = {
  customerPhone: string;
  /** Human template key (see docs/n8n-whatsapp-meta-templates.md). Maps to the Cloud API
   * template NAME + locale via CLOUD_TEMPLATE_NAME/CLOUD_TEMPLATE_LOCALE. */
  templateKey: string;
  /** Order-sensitive parameter values for the template body, e.g. ["Juan","10:00"]. */
  parameters: string[];
  bookingId?: string | null;
  customerName?: string | null;
  invoiceId?: string | null;
  messagePreview?: string | null;
};

export type SendCloudMessageResult = {
  ok: boolean;
  status: OutboundLogStatus;
  provider_message_id?: string | null;
  error?: string | null;
  log_id?: string | null;
};

// ---------------------------------------------------------------------------
// Secret redaction — copy of sanitizeForLog's token stripping so we never log the token.
// ---------------------------------------------------------------------------
const SENSITIVE_KEY = /^(access[-_]?token|authorization|api[-_]?key|x-api-key|token|secret|password|bearer)$/i;

function cloudConfig() {
  const token = Deno.env.get("WHATSAPP_CLOUD_API_TOKEN") ?? "";
  const phoneNumberId = Deno.env.get("WHATSAPP_CLOUD_PHONE_NUMBER_ID") ?? "";
  const apiVersion = Deno.env.get("WHATSAPP_CLOUD_API_VERSION") ?? "v21.0";
  const graphBase = Deno.env.get("WHATSAPP_CLOUD_GRAPH_BASE") ?? "https://graph.facebook.com";
  return { token, phoneNumberId, apiVersion, graphBase, configured: !!token && !!phoneNumberId };
}

function messagesUrl(cfg: ReturnType<typeof cloudConfig>) {
  const fqPath = cfg.graphBase.replace(/\/$/, "") + "/" + cfg.apiVersion + "/"
    + encodeURIComponent(cfg.phoneNumberId) + "/messages";
  return fqPath;
}

function extractMessageId(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const o = body as Record<string, unknown>;
  return typeof o?.messages?.id === "string" ? o.messages.id : null;
}

function extractError(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const o = body as Record<string, unknown>;
  const err = o.error as Record<string, unknown> | undefined;
  if (!err) return null;
  return `graph_api_${err.code ?? "error"}_${String(err.message ?? "").slice(0, 300)}`;
}

/** Strip the access token anywhere it appears in logged values. */
export function sanitizeForLog(value: unknown): unknown {
  const token = Deno.env.get("WHATSAPP_CLOUD_API_TOKEN") ?? "";
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

// ---------------------------------------------------------------------------
// communication_logs — same table/shape as botmaker-outbound so /admin stays in sync.
// ---------------------------------------------------------------------------
async function insertCommunicationLog(
  admin: SupabaseClient,
  row: {
    status: OutboundLogStatus;
    input: SendCloudMessageInput;
    provider_message_id?: string | null;
    error?: string | null;
    template_key?: string | null;
  },
): Promise<string | null> {
  const { data, error } = await admin.from("communication_logs").insert({
    channel: "whatsapp",
    // NEW provider value distinguishes this transport from botmaker (dedupe key below).
    provider: "whatsapp_cloud_api",
    direction: "outbound",
    booking_id: row.input.booking_id ?? null,
    message_text: row.input.message,
    raw_payload: sanitizeForLog({
      status: row.status,
      template_key: row.template_key ?? null,
      customer_phone: row.input.phone,
      customer_name: row.input.customer_name ?? null,
      invoice_id: row.input.invoice_id ?? null,
      provider_message_id: row.provider_message_id ?? null,
      error: row.error ?? null,
    }),
  }).select("id").maybeSingle();
  if (error) {
    console.warn("[send-whatsapp-cloud] communication_logs insert failed", error);
    return null;
  }
  return data?.id ?? null;
}

/**
 * Duplicate guard for templates. NOTE: intentionally provider-agnostic (channel-only) so that
 * during a parallel/rollback window a confirmation does not fire twice because the two transports
 * have different `provider` values. New code should call this instead of the botmaker-only check.
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
    console.warn("[send-whatsapp-cloud] duplicate check failed", error);
    return false;
  }
  return (data ?? []).some((row) => {
    const p = row.raw_payload as Record<string, unknown> | null;
    const status = p?.status;
    const okStatus = status === "sent" || status === "pending" || status === "accepted";
    return p?.template_key === templateKey && okStatus;
  });
}

// ---------------------------------------------------------------------------
// Send a free-form session message via the Cloud API.
// ---------------------------------------------------------------------------
export async function sendCloudWhatsApp(
  admin: SupabaseClient,
  input: SendCloudMessageInput,
): Promise<SendCloudMessageResult> {
  const phone = normalizeArgentinaWhatsAppPhone(input.phone);
  const message = (input.message ?? "").trim();
  const tplKey = input.template_key ?? null;

  const skip = async (status: OutboundLogStatus, error: string): Promise<SendCloudMessageResult> => {
    const r: SendCloudMessageResult = { ok: false, status, error };
    r.log_id = await insertCommunicationLog(admin, { status, input, error, template_key: tplKey });
    return r;
  };

  if (!phone) return skip("skipped", "invalid_phone");
  if (!message) return skip("skipped", "empty_message");

  const cfg = cloudConfig();
  if (!cfg.configured) return skip("failed", "missing_cloud_api_config");

  const body = {
    messaging_product: "whatsapp",
    to: phone,
    type: "text",
    text: { body: message },
  };

  try {
    const res = await fetch(messagesUrl(cfg), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const textBody = await res.text();
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(textBody);
    } catch {
      /* non-JSON body */
    }

    if (!res.ok) {
      const err = extractError(parsed) ?? `graph_api_http_${res.status}`;
      console.error("[send-whatsapp-cloud] send failed", res.status, textBody.slice(0, 2000));
      const result: SendCloudMessageResult = { ok: false, status: "failed", error: err };
      result.log_id = await insertCommunicationLog(admin, {
        status: "failed",
        input: { ...input, phone },
        error: err,
        template_key: tplKey,
      });
      return result;
    }

    const provider_message_id = extractMessageId(parsed);
    const result: SendCloudMessageResult = {
      ok: true,
      status: "sent",
      provider_message_id,
    };
    result.log_id = await insertCommunicationLog(admin, {
      status: "sent",
      input: { ...input, phone },
      provider_message_id,
      template_key: tplKey,
    });
    return result;
  } catch (e) {
    const err = String((e as Error)?.message ?? e);
    console.error("[send-whatsapp-cloud] exception", err);
    const result: SendCloudMessageResult = { ok: false, status: "failed", error: err };
    result.log_id = await insertCommunicationLog(admin, {
      status: "failed",
      input: { ...input, phone },
      error: err,
      template_key: tplKey,
    });
    return result;
  }
}

// ---------------------------------------------------------------------------
// Send an approved template via the Cloud API (outside the 24h window).
// ---------------------------------------------------------------------------
export async function sendCloudTemplateMessage(
  admin: SupabaseClient,
  input: SendCloudTemplateInput,
): Promise<SendCloudMessageResult> {
  const phone = normalizeArgentinaWhatsAppPhone(input.customerPhone);
  const tplKey = (input.templateKey ?? "").trim();
  const logInput: SendCloudMessageInput = {
    phone: phone ?? input.customerPhone,
    message: input.messagePreview ?? "",
    customer_name: input.customerName ?? null,
    booking_id: input.bookingId ?? null,
    invoice_id: input.invoiceId ?? null,
    template_key: tplKey || null,
  };

  const skip = async (status: OutboundLogStatus, error: string): Promise<SendCloudMessageResult> => {
    const r: SendCloudMessageResult = { ok: false, status, error };
    r.log_id = await insertCommunicationLog(admin, { status, input: logInput, error, template_key: tplKey });
    return r;
  };

  if (!phone) return skip("skipped", "invalid_phone");
  if (!tplKey) return skip("skipped", "missing_template_key");

  const cfg = cloudConfig();
  if (!cfg.configured) return skip("failed", "missing_cloud_api_config");

  // Map the human template key → Cloud API template name + locale. Must be maintained against
  // docs/n8n-whatsapp-meta-templates.md once templates are approved.
  const name = (Deno.env.get(`CLOUD_TEMPLATE_NAME_${tplKey.toUpperCase()}`) ?? tplKey).trim();
  const language = (Deno.env.get("CLOUD_TEMPLATE_LANGUAGE") ?? "es").trim();

  const body = {
    messaging_product: "whatsapp",
    to: phone,
    type: "template",
    template: {
      name,
      language: { code: language },
      components: [
        {
          type: "body",
          parameters: (input.parameters ?? []).map((p) => ({ type: "text", text: p })),
        },
      ],
    },
  };

  try {
    const res = await fetch(messagesUrl(cfg), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const textBody = await res.text();
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(textBody);
    } catch {
      /* ignore */
    }

    if (!res.ok) {
      const err = extractError(parsed) ?? `graph_api_http_${res.status}`;
      console.error("[send-whatsapp-cloud] template send failed", res.status, textBody.slice(0, 2000));
      const result: SendCloudMessageResult = { ok: false, status: "failed", error: err };
      result.log_id = await insertCommunicationLog(admin, {
        status: "failed",
        input: logInput,
        error: err,
        template_key: tplKey,
      });
      return result;
    }

    const provider_message_id = extractMessageId(parsed);
    const result: SendCloudMessageResult = { ok: true, status: "sent", provider_message_id };
    result.log_id = await insertCommunicationLog(admin, {
      status: "sent",
      input: logInput,
      provider_message_id,
      template_key: tplKey,
    });
    return result;
  } catch (e) {
    const err = String((e as Error)?.message ?? e);
    console.error("[send-whatsapp-cloud] template exception", err);
    const result: SendCloudMessageResult = { ok: false, status: "failed", error: err };
    result.log_id = await insertCommunicationLog(admin, {
      status: "failed",
      input: logInput,
      error: err,
      template_key: tplKey,
    });
    return result;
  }
}
