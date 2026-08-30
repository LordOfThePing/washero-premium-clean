// @ts-nocheck -- ported verbatim from functions/; not our source of truth for types
// The one shared WhatsApp transport module: sending (via the n8n "WhatsApp Outbound Gateway"
// webhook), duplicate-send guarding, phone normalization, and log redaction. No other file
// sends a WhatsApp message directly -- whatsapp-automation.ts (booking lifecycle notifications)
// and the whatsapp-agent subsystem's own outbound/retry paths both call sendWhatsAppMessage().
//
// SECURITY: NEVER add WHATSAPP_CLOUD_API_TOKEN / WHATSAPP_CLOUD_PHONE_NUMBER_ID as
// Supabase secrets. All Meta/WhatsApp credentials live in n8n only.
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizePhone } from "./text-utils.ts";

/** Argentina WhatsApp: prefer 549… digits without +. Moved here (from the retired
 * Botmaker-outbound module, now deleted) since every transport needs the same phone shape. */
export function normalizeArgentinaWhatsAppPhone(raw: string | null | undefined): string | null {
  const base = normalizePhone(raw);
  if (!base) return null;
  let digits = base.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = digits.slice(1);
  if (!digits.startsWith("54") && digits.length >= 8 && digits.length <= 11) {
    digits = `54${digits}`;
  }
  if (digits.length < 10) return null;
  return digits;
}

// ---------------------------------------------------------------------------
// Shared types (used by whatsapp-automation.ts).
// ---------------------------------------------------------------------------
export type OutboundLogStatus = "pending" | "sent" | "failed" | "skipped";

export type SendCloudMessageResult = {
  ok: boolean;
  status: OutboundLogStatus;
  provider_message_id?: string | null;
  error?: string | null;
  log_id?: string | null;
  /** True once the n8n gateway actually returned an HTTP response (2xx or not) -- as opposed to
   * a network error/timeout where we can't tell if the send happened. Callers that must never
   * double-send (e.g. whatsapp-agent/outbound.ts's retry logic) key off this, not `ok`, to decide
   * whether a failure is safely retryable or must be treated as ambiguous. */
  httpResponded?: boolean;
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

// ---------------------------------------------------------------------------
// n8n "WhatsApp Outbound Gateway" — the only place any code sends a WhatsApp message.
// All Meta/WhatsApp credentials live in n8n (its own WhatsApp account credential);
// Supabase never holds a Meta access token. The gateway is a headerAuth-protected
// webhook that sends text/template messages via n8n's native WhatsApp nodes.
// ---------------------------------------------------------------------------

const N8N_GATEWAY_URL = (process.env.N8N_WHATSAPP_WEBHOOK_URL ?? "").trim();
const N8N_GATEWAY_TIMEOUT_MS = 10_000;

function n8nGatewayAuthHeader(): { name: string; value: string } | null {
  const name = (process.env.N8N_WHATSAPP_WEBHOOK_HEADER ?? "x-washero-outbound-secret").trim();
  const value = (process.env.N8N_WHATSAPP_WEBHOOK_SECRET ?? "").trim();
  if (!value) return null;
  return { name, value };
}

async function insertCommunicationLog(
  admin: SupabaseClient,
  row: {
    status: OutboundLogStatus;
    payload: Record<string, unknown>;
    input: { phone: string; message?: string; booking_id?: string | null; customer_name?: string | null };
    template_key?: string | null;
    provider_message_id?: string | null;
    error?: string | null;
  },
): Promise<string | null> {
  const { data, error } = await admin.from("communication_logs").insert({
    channel: "whatsapp",
    provider: "whatsapp_n8n_gateway",
    direction: "outbound",
    booking_id: row.input.booking_id ?? null,
    message_text: row.input.message ?? "",
    raw_payload: sanitizeForLog({
      status: row.status,
      template_key: row.template_key ?? null,
      customer_phone: row.input.phone,
      customer_name: row.input.customer_name ?? null,
      provider_message_id: row.provider_message_id ?? null,
      error: row.error ?? null,
      ...row.payload,
    }),
  }).select("id").maybeSingle();
  if (error) {
    console.warn("[whatsapp-outbound] communication_logs insert failed", error);
    return null;
  }
  return data?.id ?? null;
}

/**
 * POST one outbound WhatsApp message (free text or an approved template) to the n8n gateway
 * webhook. Never throws past the caller: every failure (non-2xx, ok:false, timeout, network
 * error) is logged, written to communication_logs, and returned as an ok:false result.
 */
export async function sendWhatsAppMessage(
  admin: SupabaseClient,
  opts: {
    phone: string;
    kind: "text" | "template";
    text?: string;
    templateKey?: string;
    templateName?: string;
    variables?: Record<string, unknown>;
    conversationId?: string;
    customerName?: string | null;
    bookingId?: string;
    templateKeyLabel?: string | null;
  },
): Promise<SendCloudMessageResult> {
  const phone = normalizeArgentinaWhatsAppPhone(opts.phone);
  const body: Record<string, unknown> = {
    kind: opts.kind,
    phone: phone ?? opts.phone,
    customer_name: opts.customerName ?? null,
  };
  if (opts.kind === "text") {
    body.text = (opts.text ?? "").trim();
  } else {
    body.template_key = opts.templateKey;
    body.template_name = opts.templateName || opts.templateKey;
    body.variables = opts.variables ?? {};
  }
  body.conversation_id = opts.conversationId || opts.phone;

  const baseLog = {
    phone: phone ?? opts.phone,
    message: opts.kind === "text" ? (opts.text ?? "").trim() : "",
    booking_id: opts.bookingId ?? null,
    customer_name: opts.customerName ?? undefined,
  };
  const tplLabel = opts.templateKeyLabel ?? opts.templateKey ?? null;

  if (!phone) {
    return { ok: false, status: "skipped", error: "invalid_phone", httpResponded: false };
  }
  const auth = n8nGatewayAuthHeader();
  if (!N8N_GATEWAY_URL || !auth) {
    return {
      ok: false,
      status: "failed",
      error: "missing_n8n_gateway_config",
      httpResponded: false,
      log_id: await insertCommunicationLog(admin, {
        status: "failed",
        input: baseLog,
        template_key: tplLabel,
        error: "missing_n8n_gateway_config",
        payload: { kind: opts.kind },
      }),
    };
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), N8N_GATEWAY_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(N8N_GATEWAY_URL, {
        method: "POST",
        headers: Object.assign({ "Content-Type": "application/json" }, { [auth.name]: auth.value }),
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    const textBody = await res.text();
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(textBody);
    } catch {
      /* non-JSON */
    }
    const parsedObj = (parsed ?? {}) as Record<string, unknown>;

    if (!res.ok) {
      const err = "n8n_gateway_http_" + res.status + "_" + textBody.slice(0, 300);
      console.error("[whatsapp-outbound] n8n gateway send failed", res.status, textBody.slice(0, 2000));
      return {
        ok: false,
        status: "failed",
        error: err,
        httpResponded: true,
        log_id: await insertCommunicationLog(admin, {
          status: "failed",
          input: baseLog,
          template_key: tplLabel,
          error: err,
          payload: { kind: opts.kind, http_status: res.status },
        }),
      };
    }

    if (parsedObj?.ok !== true) {
      const err = "n8n_gateway_ok_false_" + String(parsedObj?.error ?? "unknown");
      console.error("[whatsapp-outbound] n8n gateway returned ok:false", textBody.slice(0, 2000));
      return {
        ok: false,
        status: "failed",
        error: err,
        httpResponded: true,
        log_id: await insertCommunicationLog(admin, {
          status: "failed",
          input: baseLog,
          template_key: tplLabel,
          error: err,
          payload: { kind: opts.kind },
        }),
      };
    }

    const provider_message_id =
      typeof parsedObj?.provider_message_id === "string" && parsedObj.provider_message_id
        ? parsedObj.provider_message_id
        : null;
    return {
      ok: true,
      status: "sent",
      httpResponded: true,
      provider_message_id,
      log_id: await insertCommunicationLog(admin, {
        status: "sent",
        input: baseLog,
        template_key: tplLabel,
        provider_message_id,
        payload: { kind: opts.kind },
      }),
    };
  } catch (e) {
    const err = String((e as Error)?.message ?? e);
    console.error("[whatsapp-outbound] n8n gateway exception", err);
    return {
      ok: false,
      status: "failed",
      error: err,
      httpResponded: false,
      log_id: await insertCommunicationLog(admin, {
        status: "failed",
        input: baseLog,
        template_key: tplLabel,
        error: err,
        payload: { kind: opts.kind },
      }),
    };
  }
}
