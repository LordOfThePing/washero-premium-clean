import { db } from "@/integrations/db/client";

export type WhatsappDiagnosticsStatus = {
  gateway_url_configured: boolean;
  gateway_secret_configured: boolean;
  inbox: {
    conversations: number;
    messages: number;
    last_conversation_at: string | null;
    last_message_at: string | null;
  };
  outbound_whatsapp: {
    sent_last_24h: number;
    sent_last_7d: number;
    last_sent: { created_at: string; message_preview: string; template_key: string | null } | null;
    last_failed: { created_at: string; error: string | null; template_key: string | null } | null;
    recent_failed: Array<{ created_at: string; error: string | null; template_key: string | null }>;
  };
};

export type SendWhatsappMessageResponse = {
  ok: boolean;
  status?: string;
  error?: string | null;
  provider_message_id?: string | null;
};

export async function fetchWhatsappDiagnostics(): Promise<WhatsappDiagnosticsStatus> {
  const { data, error } = await db.functions.invoke("whatsapp-diagnostics", {
    body: { action: "status" },
  });
  if (error) throw error;
  return data as WhatsappDiagnosticsStatus;
}

export async function sendWhatsappMessage(payload: {
  phone?: string;
  customer_name?: string | null;
  message?: string;
  booking_id?: string | null;
  invoice_id?: string | null;
  template_key?: string | null;
}): Promise<SendWhatsappMessageResponse> {
  const { data, error } = await db.functions.invoke("send-whatsapp-message", { body: payload });
  if (error) return { ok: false, error: error.message };
  return (data ?? { ok: false, error: "empty_response" }) as SendWhatsappMessageResponse;
}

export async function sendBookingReminders(): Promise<{
  ok: boolean;
  target_date?: string;
  total_candidates?: number;
  sent?: number;
  skipped?: number;
  failed?: number;
  error?: string;
}> {
  const { data, error } = await db.functions.invoke("send-booking-reminders", { body: {} });
  if (error) return { ok: false, error: error.message };
  return data as {
    ok: boolean;
    target_date?: string;
    total_candidates?: number;
    sent?: number;
    skipped?: number;
    failed?: number;
  };
}

export function communicationLogStatus(raw: unknown): string {
  if (!raw || typeof raw !== "object") return "—";
  const s = (raw as Record<string, unknown>).status;
  return typeof s === "string" ? s : "—";
}

export function communicationLogTemplate(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const t = (raw as Record<string, unknown>).template_key;
  return typeof t === "string" ? t : null;
}

export function communicationLogPhone(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const p = (raw as Record<string, unknown>).customer_phone;
  return typeof p === "string" ? p : null;
}
