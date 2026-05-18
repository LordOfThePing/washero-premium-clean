// Outbound WhatsApp via Botmaker API (server-side only).
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { normalizePhone } from "./botmaker-booking.ts";

export type OutboundLogStatus = "pending" | "sent" | "failed" | "skipped";

export type LoggedHttpRequest = {
  url: string;
  path: string;
  method: string;
  payload: Record<string, unknown>;
};

export type LoggedHttpResponse = {
  status: number;
  statusText: string;
  bodyText: string;
  body: unknown | null;
};

export type SendBotmakerMessageInput = {
  phone: string;
  message: string;
  customer_name?: string | null;
  booking_id?: string | null;
  invoice_id?: string | null;
  template_key?: string | null;
};

export type SendBotmakerMessageResult = {
  ok: boolean;
  status: OutboundLogStatus;
  provider_message_id?: string | null;
  error?: string | null;
  log_id?: string | null;
  request?: LoggedHttpRequest | null;
  response?: LoggedHttpResponse | null;
};

const DEFAULT_BASE = "https://api.botmaker.com/v2.0";
const DEFAULT_SEND_PATH = "/chats-actions/send-message";

const SENSITIVE_KEY = /^(access[-_]?token|authorization|api[-_]?key|x-api-key|token|secret|password|bearer)$/i;

/** Strip secrets from values persisted or returned to admin UI. Never logs BOTMAKER_API_TOKEN. */
export function sanitizeForLog(value: unknown, depth = 0): unknown {
  if (depth > 10) return "[truncated]";
  const token = Deno.env.get("BOTMAKER_API_TOKEN") ?? "";

  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    if (!token) return value;
    return value.split(token).join("[REDACTED]");
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value.map((v) => sanitizeForLog(v, depth + 1));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY.test(k)) {
        out[k] = "[REDACTED]";
      } else {
        out[k] = sanitizeForLog(v, depth + 1);
      }
    }
    return out;
  }
  return String(value);
}

/** Argentina WhatsApp: prefer 549… digits without + */
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

function extractProviderMessageId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const o = payload as Record<string, unknown>;
  const candidates = [
    o.id,
    o.messageId,
    o.message_id,
    (o.data as Record<string, unknown> | undefined)?.id,
    (o.result as Record<string, unknown> | undefined)?.id,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c) return c;
    if (typeof c === "number") return String(c);
  }
  return null;
}

function parseResponseBody(text: string): { bodyText: string; body: unknown | null } {
  const bodyText = text ?? "";
  if (!bodyText.trim()) {
    return { bodyText, body: null };
  }
  try {
    return { bodyText, body: JSON.parse(bodyText) };
  } catch {
    return { bodyText, body: null };
  }
}

async function readHttpResponse(res: Response): Promise<LoggedHttpResponse> {
  const bodyText = await res.text();
  const { body } = parseResponseBody(bodyText);
  return {
    status: res.status,
    statusText: res.statusText || "",
    bodyText,
    body: body !== null ? sanitizeForLog(body) : null,
  };
}

async function insertCommunicationLog(
  admin: SupabaseClient,
  row: {
    status: OutboundLogStatus;
    input: SendBotmakerMessageInput;
    provider_message_id?: string | null;
    error?: string | null;
    request?: LoggedHttpRequest | null;
    response?: LoggedHttpResponse | null;
  },
): Promise<string | null> {
  const { data, error } = await admin.from("communication_logs").insert({
    channel: "whatsapp",
    provider: "botmaker",
    direction: "outbound",
    booking_id: row.input.booking_id ?? null,
    message_text: row.input.message,
    raw_payload: sanitizeForLog({
      status: row.status,
      template_key: row.input.template_key ?? null,
      customer_phone: row.input.phone,
      customer_name: row.input.customer_name ?? null,
      invoice_id: row.input.invoice_id ?? null,
      provider_message_id: row.provider_message_id ?? null,
      error: row.error ?? null,
      request: row.request ?? null,
      response: row.response ?? null,
    }),
  }).select("id").maybeSingle();
  if (error) {
    console.warn("[botmaker-outbound] communication_logs insert failed", error);
    return null;
  }
  return data?.id ?? null;
}

/**
 * Sends a WhatsApp text via Botmaker. Never throws — failures are logged.
 * Adjust BOTMAKER_SEND_PATH / payload shape in one place if Botmaker changes API.
 */
export async function sendBotmakerWhatsApp(
  admin: SupabaseClient,
  input: SendBotmakerMessageInput,
): Promise<SendBotmakerMessageResult> {
  const phone = normalizeArgentinaWhatsAppPhone(input.phone);
  const message = (input.message ?? "").trim();

  if (!phone) {
    const r: SendBotmakerMessageResult = {
      ok: false,
      status: "skipped",
      error: "invalid_phone",
      request: null,
      response: null,
    };
    r.log_id = await insertCommunicationLog(admin, {
      status: "skipped",
      input: { ...input, phone: input.phone },
      error: r.error,
    });
    return r;
  }

  if (!message) {
    const r: SendBotmakerMessageResult = {
      ok: false,
      status: "skipped",
      error: "empty_message",
      request: null,
      response: null,
    };
    r.log_id = await insertCommunicationLog(admin, { status: "skipped", input, error: r.error });
    return r;
  }

  const token = Deno.env.get("BOTMAKER_API_TOKEN") ?? "";
  if (!token) {
    const r: SendBotmakerMessageResult = {
      ok: false,
      status: "failed",
      error: "missing_botmaker_token",
      request: null,
      response: null,
    };
    r.log_id = await insertCommunicationLog(admin, { status: "failed", input, error: r.error });
    return r;
  }

  const baseUrl = (Deno.env.get("BOTMAKER_BASE_URL") ?? DEFAULT_BASE).replace(/\/$/, "");
  const sendPath = Deno.env.get("BOTMAKER_SEND_PATH") ?? DEFAULT_SEND_PATH;
  const channelId = Deno.env.get("BOTMAKER_CHANNEL_ID") ?? "";
  const requestUrl = `${baseUrl}${sendPath.startsWith("/") ? sendPath : `/${sendPath}`}`;

  const requestPayload: Record<string, unknown> = {
    chatPlatform: "whatsapp",
    platformContactId: phone,
    messageText: message,
  };
  if (channelId) {
    requestPayload.chatChannelNumber = channelId;
    requestPayload.channelId = channelId;
  }

  const httpRequest: LoggedHttpRequest = {
    url: requestUrl,
    path: sendPath,
    method: "POST",
    payload: requestPayload,
  };

  try {
    const res = await fetch(requestUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "access-token": token,
      },
      body: JSON.stringify(requestPayload),
    });

    const httpResponse = await readHttpResponse(res);

    if (!res.ok) {
      const err = `botmaker_http_${res.status}`;
      console.error(
        "[botmaker-outbound] send failed",
        res.status,
        res.statusText,
        httpResponse.bodyText.slice(0, 2000),
      );
      const r: SendBotmakerMessageResult = {
        ok: false,
        status: "failed",
        error: err,
        request: httpRequest,
        response: httpResponse,
      };
      r.log_id = await insertCommunicationLog(admin, {
        status: "failed",
        input: { ...input, phone },
        error: err,
        request: httpRequest,
        response: httpResponse,
      });
      return r;
    }

    const provider_message_id = extractProviderMessageId(httpResponse.body);
    const r: SendBotmakerMessageResult = {
      ok: true,
      status: "sent",
      provider_message_id,
      request: httpRequest,
      response: httpResponse,
    };
    r.log_id = await insertCommunicationLog(admin, {
      status: "sent",
      input: { ...input, phone },
      provider_message_id,
      request: httpRequest,
      response: httpResponse,
    });
    return r;
  } catch (e) {
    const err = String((e as Error)?.message ?? e);
    console.error("[botmaker-outbound] exception", err);
    const httpResponse: LoggedHttpResponse = {
      status: 0,
      statusText: "network_error",
      bodyText: err,
      body: null,
    };
    const r: SendBotmakerMessageResult = {
      ok: false,
      status: "failed",
      error: err,
      request: httpRequest,
      response: httpResponse,
    };
    r.log_id = await insertCommunicationLog(admin, {
      status: "failed",
      input: { ...input, phone },
      error: err,
      request: httpRequest,
      response: httpResponse,
    });
    return r;
  }
}

export async function hasOutboundTemplateLog(
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
    .eq("provider", "botmaker")
    .eq("direction", "outbound")
    .order("created_at", { ascending: false })
    .limit(20);

  if (sinceIso) q = q.gte("created_at", sinceIso);

  const { data, error } = await q;
  if (error) {
    console.warn("[botmaker-outbound] duplicate check failed", error);
    return false;
  }
  return (data ?? []).some((row) => {
    const p = row.raw_payload as Record<string, unknown> | null;
    return p?.template_key === templateKey && p?.status === "sent";
  });
}
