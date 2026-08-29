// @ts-nocheck -- ported verbatim from supabase/functions; not our source of truth for types
// Lifecycle WhatsApp notifications (non-blocking callers should void + catch).
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  hasOutboundTemplateLog,
  sendBotmakerTemplateMessage,
  sendBotmakerWhatsApp,
  type SendBotmakerMessageResult,
} from "./botmaker-outbound.ts";
import {
  hasOutboundTemplateLogChannelOnly,
  type OutboundLogStatus,
  type SendCloudMessageResult,
} from "./cloud-api-outbound.ts";
import { normalizeArgentinaWhatsAppPhone } from "./botmaker-outbound.ts";

/**
 * Transport toggle for the Botmaker → WhatsApp Cloud API cutover.
 *   WASHERO_TRANSPORT = cloud_api (default after cutover) | botmaker (rollback).
 * Both transports write the same `communication_logs`, so dedupe is safe across a flip.
 */
type WasheroTransport = "botmaker" | "cloud_api";
function resolveTransport(): WasheroTransport {
  const t = (process.env.WASHERO_TRANSPORT ?? "cloud_api").trim().toLowerCase();
  return t === "botmaker" ? "botmaker" : "cloud_api";
}

// ---------------------------------------------------------------------------
// n8n "WhatsApp Outbound Gateway" transport.
// All outbound Meta/WhatsApp credentials live ONLY in n8n (n8n's own WhatsApp
// account credential). Supabase never holds a Meta access token.
// The gateway is a headerAuth-protected webhook that sends text/template
// messages via n8n's native WhatsApp nodes.
// ---------------------------------------------------------------------------

const N8N_GATEWAY_URL = (process.env.N8N_WHATSAPP_WEBHOOK_URL ?? "").trim();
const N8N_GATEWAY_TIMEOUT_MS = 10_000;

const N8N_SENSITIVE_KEY = /^(access[-_]?token|authorization|api[-_]?key|x-api-key|token|secret|password|bearer)$/i;

/** Redact secrets from anything written to communication_logs.raw_payload. */
function n8nSanitizeForLog(value: unknown, depth = 0): unknown {
  if (depth > 10) return "[truncated]";
  const secrets = [
    process.env.N8N_WHATSAPP_WEBHOOK_SECRET ?? "",
    process.env.WHATSAPP_CLOUD_API_TOKEN ?? "",
  ].filter(Boolean);
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    for (const s of secrets) value = (value as string).split(s).join("[REDACTED]");
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map((v) => n8nSanitizeForLog(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (N8N_SENSITIVE_KEY.test(k)) out[k] = "[REDACTED]";
      else out[k] = n8nSanitizeForLog(v, depth + 1);
    }
    return out;
  }
  return String(value);
}

/**
 * Header the gateway webhook checks. Defaults to x-washero-outbound-secret,
 * which must match the dedicated "Washero Outbound Webhook Auth" n8n credential
 * (NOT botmaker-tools' shared secret). Override via N8N_WHATSAPP_WEBHOOK_HEADER.
 */
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
    raw_payload: n8nSanitizeForLog({
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
    console.warn("[whatsapp-automation] communication_logs insert failed", error);
    return null;
  }
  return data?.id ?? null;
}

/**
 * POST one outbound message to the n8n gateway webhook. Never throws past the
 * caller: every failure (non-2xx, ok:false, timeout, network error) is logged,
 * written to communication_logs, and returned as an ok:false result so the
 * booking flow never crashes over a notification failure.
 */
async function sendViaN8nGateway(
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
    return { ok: false, status: "skipped", error: "invalid_phone" };
  }
  const auth = n8nGatewayAuthHeader();
  if (!N8N_GATEWAY_URL || !auth) {
    return {
      ok: false,
      status: "failed",
      error: "missing_n8n_gateway_config",
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
      console.error("[whatsapp-automation] n8n gateway send failed", res.status, textBody.slice(0, 2000));
      return {
        ok: false,
        status: "failed",
        error: err,
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
      console.error("[whatsapp-automation] n8n gateway returned ok:false", textBody.slice(0, 2000));
      return {
        ok: false,
        status: "failed",
        error: err,
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
    console.error("[whatsapp-automation] n8n gateway exception", err);
    return {
      ok: false,
      status: "failed",
      error: err,
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

/** Provider-agnostic dedupe so a confirmation never fires twice across a transport flip. */
export async function hasOutboundTemplateLogAny(
  admin: SupabaseClient,
  bookingId: string,
  templateKey: string,
  sinceIso?: string,
): Promise<boolean> {
  if (resolveTransport() === "cloud_api") {
    return hasOutboundTemplateLogChannelOnly(admin, bookingId, templateKey, sinceIso);
  }
  return hasOutboundTemplateLog(admin, bookingId, templateKey, sinceIso);
}

/** Send an approved WhatsApp template through the selected transport. */
export async function sendTemplateViaTransport(
  admin: SupabaseClient,
  opts: {
    customerPhone: string;
    customerName: string | null;
    bookingId: string;
    templateKey: string;
    botmakerVariables: Record<string, unknown>;
    messagePreview: string;
    /** Cloud API order-sensitive parameters (template body components). */
    cloudParameters: string[];
  },
): Promise<SendBotmakerMessageResult | SendCloudMessageResult> {
  if (resolveTransport() === "cloud_api") {
    // Route through the n8n "WhatsApp Outbound Gateway". The gateway's per-template
    // branches read NAMED variables (e.g. firstName/service/date/time/address),
    // which match opts.botmakerVariables key-for-key. opts.cloudParameters is the
    // legacy positional Cloud API array and is intentionally NOT sent to n8n.
    return sendViaN8nGateway(admin, {
      phone: opts.customerPhone,
      kind: "template",
      templateKey: opts.templateKey,
      templateName: opts.templateKey,
      variables: opts.botmakerVariables,
      customerName: opts.customerName,
      bookingId: opts.bookingId,
      // bookingFlow sends a preview for the log; n8n needs the real variables only.
      templateKeyLabel: opts.templateKey,
    });
  }
  return sendBotmakerTemplateMessage(admin, {
    customerPhone: opts.customerPhone,
    customerName: opts.customerName,
    bookingId: opts.bookingId,
    templateKey: opts.templateKey,
    variables: opts.botmakerVariables,
    messagePreview: opts.messagePreview,
  });
}

/** Send a free-form/session WhatsApp text through the selected transport. */
export async function sendTextViaTransport(
  admin: SupabaseClient,
  opts: {
    phone: string;
    message: string;
    bookingId: string;
    templateKey: string | null;
    customerName: string | null;
  },
): Promise<SendBotmakerMessageResult | SendCloudMessageResult> {
  if (resolveTransport() === "cloud_api") {
    // Free-form/session text through the n8n gateway. A template_key (e.g. manual
    // resends of payment_confirmed / booking_reminder_tomorrow) is preserved for
    // communication_logs labelling but the message is sent as kind:"text".
    return sendViaN8nGateway(admin, {
      phone: opts.phone,
      kind: "text",
      text: opts.message,
      customerName: opts.customerName,
      bookingId: opts.bookingId,
      templateKeyLabel: opts.templateKey,
    });
  }
  return sendBotmakerWhatsApp(admin, {
    phone: opts.phone,
    message: opts.message,
    booking_id: opts.bookingId,
    template_key: opts.templateKey,
    customer_name: opts.customerName,
  });
}

/** Result of any transport-backed WhatsApp send in this module. */
export type WasheroSendResult = SendBotmakerMessageResult | SendCloudMessageResult;

export type BookingNotifyRow = {
  id: string;
  customer_name: string;
  customer_phone: string;
  service_name: string;
  scheduled_date: string;
  scheduled_time: string;
  address: string;
  formatted_address: string | null;
  booking_status: string;
  payment_status: string;
  payment_method: string;
  price: number;
  booking_source?: string | null;
};

const CUSTOMER_SITE_ORIGIN = (process.env.PUBLIC_SITE_URL ?? "https://washero.ar").replace(/\/+$/, "");

function fmtDate(iso: string) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("es-AR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

function fmtTime(t: string) {
  return (t ?? "").slice(0, 5) || "—";
}

function firstName(full: string) {
  return full.trim().split(/\s+/)[0] || full;
}

function addressLine(b: BookingNotifyRow) {
  return b.formatted_address || b.address || "—";
}

function bookingStatusLabel(status: string) {
  if (status === "needs_review") return "Solicitud en revisión";
  if (status === "confirmed") return "Confirmada";
  if (status === "pending") return "Pendiente de confirmación";
  if (status === "in_progress") return "En curso";
  if (status === "completed") return "Completada";
  if (status === "cancelled") return "Cancelada";
  return status;
}

export function buildBookingCreatedMessage(b: BookingNotifyRow): string {
  const name = firstName(b.customer_name);
  const isReview = b.booking_status === "needs_review";
  const intro = isReview
    ? `Hola ${name} 👋\nRecibimos tu *solicitud* en Washero.`
    : `Hola ${name} 👋\nRecibimos tu *reserva* en Washero.`;

  return `${intro}

*Servicio:* ${b.service_name}
*Fecha:* ${fmtDate(b.scheduled_date)}
*Horario:* ${fmtTime(b.scheduled_time)}
*Dirección:* ${addressLine(b)}

*Estado:* ${bookingStatusLabel(b.booking_status)}
*Pago:* ${b.payment_method}

Te vamos a contactar si necesitamos ajustar algún detalle.`;
}

export function buildBookingConfirmedPreview(b: BookingNotifyRow): string {
  const name = firstName(b.customer_name);
  return `Hola ${name}, tu reserva de Washero está confirmada para el ${fmtDate(b.scheduled_date)} a las ${fmtTime(b.scheduled_time)}.`;
}

export function buildPaymentConfirmedMessage(
  b: Pick<BookingNotifyRow, "customer_name" | "price">,
  invoiceNumber: string | null,
  total: number,
  customerInvoiceUrl?: string | null,
): string {
  const name = firstName(b.customer_name);
  const totalLine = total > 0
    ? `\n*Total:* $${total.toLocaleString("es-AR")}`
    : "";
  const receipt = invoiceNumber
    ? `\n*Comprobante interno:* ${invoiceNumber}`
    : "";
  const linkLine = customerInvoiceUrl
    ? `\nPodés ver tu comprobante acá: ${customerInvoiceUrl}`
    : "";

  return `Hola ${name} 👋
Registramos el *pago* de tu lavado Washero.${receipt}${totalLine}
${linkLine}

Gracias por elegir Washero.`;
}

export function getCustomerInvoiceUrl(invoice: { public_token?: string | null }) {
  const token = String(invoice.public_token ?? "").trim();
  if (!token) return null;
  return `${CUSTOMER_SITE_ORIGIN}/comprobante/${token}`;
}

export function buildBookingReminderMessage(b: BookingNotifyRow): string {
  const name = firstName(b.customer_name);
  return `Hola ${name} 👋
Te recordamos tu lavado Washero:

*Servicio:* ${b.service_name}
*Fecha:* ${fmtDate(b.scheduled_date)}
*Horario:* ${fmtTime(b.scheduled_time)}
*Dirección:* ${addressLine(b)}

Si necesitás modificar algo, respondé este mensaje.`;
}

export type WasheroTransferBankDetails = {
  alias: string;
  cbu: string;
  holder: string;
  bank: string;
};

/** Botmaker approved template for website Transferencia bank instructions. */
export const BANK_TRANSFER_INFO_TEMPLATE_KEY = "bank_transfer_info";

/** Bank details for Transferencia WhatsApp — from Edge Function secrets only. */
export function loadWasheroTransferBankDetails(): WasheroTransferBankDetails | null {
  const alias = (process.env.WASHERO_TRANSFER_ALIAS ?? "").trim();
  const cbu = (process.env.WASHERO_TRANSFER_CBU ?? "").trim();
  const holder = (process.env.WASHERO_TRANSFER_HOLDER ?? "").trim();
  const bank = (process.env.WASHERO_TRANSFER_BANK ?? "").trim();
  if (!alias || !cbu || !holder || !bank) return null;
  return { alias, cbu, holder, bank };
}

function formatTransferAmount(price: number): string {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(price);
}

export function buildTransferInstructionsPreview(
  booking: Pick<
    BookingNotifyRow,
    "customer_name" | "price" | "scheduled_date" | "scheduled_time"
  >,
  bank: WasheroTransferBankDetails,
): string {
  const name = firstName(booking.customer_name);
  return `Hola ${name} 👋
Para confirmar tu reserva Washero, transferí *${formatTransferAmount(booking.price)}*:

*Alias:* ${bank.alias}
*CBU/CVU:* ${bank.cbu}
*Titular:* ${bank.holder}
*Banco/billetera:* ${bank.bank}

*Turno:* ${fmtDate(booking.scheduled_date)} · ${fmtTime(booking.scheduled_time)}

Respondé este chat con el comprobante. Confirmamos cuando validemos el pago.`;
}

export async function fetchBookingForNotify(
  admin: SupabaseClient,
  bookingId: string,
): Promise<BookingNotifyRow | null> {
  const { data, error } = await admin
    .from("bookings")
    .select(
      "id, customer_name, customer_phone, service_name, scheduled_date, scheduled_time, address, formatted_address, booking_status, payment_status, payment_method, price, booking_source",
    )
    .eq("id", bookingId)
    .maybeSingle();
  if (error || !data) return null;
  return data as BookingNotifyRow;
}

/** Fire-and-forget safe wrapper — logs errors, never throws. */
export function scheduleBookingCreatedWhatsApp(
  admin: SupabaseClient,
  bookingId: string,
  opts?: { skipSources?: string[]; allowBotmakerSource?: boolean },
): void {
  void notifyBookingCreated(admin, bookingId, opts).catch((e) =>
    console.error("[whatsapp-automation] booking_created", e)
  );
}

/** After booking is confirmed (e.g. MercadoPago webhook). Same template + dedupe as create path. */
export function scheduleBookingConfirmedWhatsApp(
  admin: SupabaseClient,
  bookingId: string,
  opts?: { skipSources?: string[]; allowBotmakerSource?: boolean },
): void {
  void notifyBookingConfirmed(admin, bookingId, opts).catch((e) =>
    console.error("[whatsapp-automation] booking_confirmed", e)
  );
}

export async function notifyBookingCreated(
  admin: SupabaseClient,
  bookingId: string,
  opts?: { skipSources?: string[]; allowBotmakerSource?: boolean },
): Promise<WasheroSendResult | null> {
  const booking = await fetchBookingForNotify(admin, bookingId);
  if (!booking?.customer_phone?.trim()) return null;

  const source = (booking.booking_source ?? "").toLowerCase();
  if (
    !opts?.allowBotmakerSource &&
    (opts?.skipSources?.includes(source) || source === "botmaker")
  ) {
    return null;
  }

  if (await hasOutboundTemplateLogAny(admin, bookingId, "booking_confirmed_v2")) {
    return { ok: false, status: "skipped", error: "duplicate_template" };
  }

  return sendTemplateViaTransport(admin, {
    customerPhone: booking.customer_phone,
    customerName: booking.customer_name,
    bookingId,
    templateKey: "booking_confirmed_v2",
    botmakerVariables: {
      firstName: firstName(booking.customer_name),
      service: booking.service_name,
      date: fmtDate(booking.scheduled_date),
      time: fmtTime(booking.scheduled_time),
      address: addressLine(booking),
    },
    cloudParameters: [
      firstName(booking.customer_name),
      booking.service_name,
      fmtDate(booking.scheduled_date),
      fmtTime(booking.scheduled_time),
      addressLine(booking),
    ],
    messagePreview: buildBookingConfirmedPreview(booking),
  });
}

/** Sends booking_confirmed_v2 when the booking is actually confirmed (idempotent). */
export async function notifyBookingConfirmed(
  admin: SupabaseClient,
  bookingId: string,
  opts?: { skipSources?: string[]; allowBotmakerSource?: boolean },
): Promise<WasheroSendResult | null> {
  return notifyBookingCreated(admin, bookingId, opts);
}

/** Fire-and-forget — bank transfer instructions for website Transferencia bookings. */
export function scheduleTransferInstructionsWhatsApp(
  admin: SupabaseClient,
  bookingId: string,
): void {
  void notifyTransferInstructions(admin, bookingId).catch((e) =>
    console.error("[whatsapp-automation] bank_transfer_info", e)
  );
}

export async function notifyTransferInstructions(
  admin: SupabaseClient,
  bookingId: string,
): Promise<WasheroSendResult | null> {
  const booking = await fetchBookingForNotify(admin, bookingId);
  if (!booking?.customer_phone?.trim()) return null;
  if (booking.payment_method !== "Transferencia") {
    return { ok: false, status: "skipped", error: "not_transferencia" };
  }
  if (booking.payment_status === "paid") {
    return { ok: false, status: "skipped", error: "already_paid" };
  }

  if (await hasOutboundTemplateLogAny(admin, bookingId, BANK_TRANSFER_INFO_TEMPLATE_KEY)) {
    return { ok: false, status: "skipped", error: "duplicate_template" };
  }

  const bank = loadWasheroTransferBankDetails();
  if (!bank) {
    console.error(
      "[whatsapp-automation] bank_transfer_info skipped: missing WASHERO_TRANSFER_ALIAS, " +
        "WASHERO_TRANSFER_CBU, WASHERO_TRANSFER_HOLDER, or WASHERO_TRANSFER_BANK",
    );
    return { ok: false, status: "skipped", error: "missing_transfer_bank_config" };
  }

  return sendTemplateViaTransport(admin, {
    customerPhone: booking.customer_phone,
    customerName: booking.customer_name,
    bookingId,
    templateKey: BANK_TRANSFER_INFO_TEMPLATE_KEY,
    botmakerVariables: {
      customerName: booking.customer_name,
      amount: formatTransferAmount(booking.price),
      alias: bank.alias,
      cbu: bank.cbu,
      holder: bank.holder,
      bank: bank.bank,
      date: fmtDate(booking.scheduled_date),
      time: fmtTime(booking.scheduled_time),
    },
    cloudParameters: [
      booking.customer_name,
      formatTransferAmount(booking.price),
      bank.alias,
      bank.cbu,
      bank.holder,
      bank.bank,
      fmtDate(booking.scheduled_date),
      fmtTime(booking.scheduled_time),
    ],
    messagePreview: buildTransferInstructionsPreview(booking, bank),
  });
}

export function schedulePaymentConfirmedWhatsApp(
  admin: SupabaseClient,
  bookingId: string,
): void {
  void notifyPaymentConfirmed(admin, bookingId).catch((e) =>
    console.error("[whatsapp-automation] payment_confirmed", e)
  );
}

export async function notifyPaymentConfirmed(
  admin: SupabaseClient,
  bookingId: string,
): Promise<WasheroSendResult | null> {
  const booking = await fetchBookingForNotify(admin, bookingId);
  if (!booking?.customer_phone?.trim()) return null;
  if (booking.payment_status !== "paid") return null;

  if (await hasOutboundTemplateLogAny(admin, bookingId, "payment_confirmed")) {
    return { ok: false, status: "skipped", error: "duplicate_template" };
  }

  const invoiceWithToken = await admin
    .from("invoices")
    .select("id, invoice_number, total, public_token")
    .eq("booking_id", bookingId)
    .maybeSingle();
  const invoiceBasic = invoiceWithToken.error
    ? await admin
        .from("invoices")
        .select("id, invoice_number, total")
        .eq("booking_id", bookingId)
        .maybeSingle()
    : null;
  const invoice = (invoiceWithToken.error ? invoiceBasic?.data : invoiceWithToken.data) as
    | { id?: string; invoice_number?: string | null; total?: number | null; public_token?: string | null }
    | null;

  const total = Number(invoice?.total ?? booking.price ?? 0);
  if (total <= 0 && !invoice?.invoice_number) {
    return null;
  }

  const customerInvoiceUrl = getCustomerInvoiceUrl({ public_token: invoice?.public_token ?? null });

  return sendTextViaTransport(admin, {
    phone: booking.customer_phone,
    message: buildPaymentConfirmedMessage(
      booking,
      invoice?.invoice_number ?? null,
      total,
      customerInvoiceUrl,
    ),
    bookingId,
    templateKey: "payment_confirmed",
    customerName: booking.customer_name,
  });
}
