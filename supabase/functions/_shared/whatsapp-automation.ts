// Lifecycle WhatsApp notifications (non-blocking callers should void + catch).
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  hasOutboundTemplateLog,
  sendBotmakerWhatsApp,
  type SendBotmakerMessageResult,
} from "./botmaker-outbound.ts";

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

export function buildPaymentConfirmedMessage(
  b: Pick<BookingNotifyRow, "customer_name" | "price">,
  invoiceNumber: string | null,
  total: number,
): string {
  const name = firstName(b.customer_name);
  const totalLine = total > 0
    ? `\n*Total:* $${total.toLocaleString("es-AR")}`
    : "";
  const receipt = invoiceNumber
    ? `\n*Comprobante interno:* ${invoiceNumber}`
    : "";

  return `Hola ${name} 👋
Registramos el *pago* de tu lavado Washero.${receipt}${totalLine}

Gracias por elegir Washero.`;
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
  opts?: { skipSources?: string[] },
): void {
  void notifyBookingCreated(admin, bookingId, opts).catch((e) =>
    console.error("[whatsapp-automation] booking_created", e)
  );
}

export async function notifyBookingCreated(
  admin: SupabaseClient,
  bookingId: string,
  opts?: { skipSources?: string[] },
): Promise<SendBotmakerMessageResult | null> {
  const booking = await fetchBookingForNotify(admin, bookingId);
  if (!booking?.customer_phone?.trim()) return null;

  const source = (booking.booking_source ?? "").toLowerCase();
  if (opts?.skipSources?.includes(source) || source === "botmaker") {
    return null;
  }

  if (await hasOutboundTemplateLog(admin, bookingId, "booking_created")) {
    return { ok: false, status: "skipped", error: "duplicate_template" };
  }

  return sendBotmakerWhatsApp(admin, {
    phone: booking.customer_phone,
    customer_name: booking.customer_name,
    booking_id: bookingId,
    template_key: "booking_created",
    message: buildBookingCreatedMessage(booking),
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
): Promise<SendBotmakerMessageResult | null> {
  const booking = await fetchBookingForNotify(admin, bookingId);
  if (!booking?.customer_phone?.trim()) return null;
  if (booking.payment_status !== "paid") return null;

  if (await hasOutboundTemplateLog(admin, bookingId, "payment_confirmed")) {
    return { ok: false, status: "skipped", error: "duplicate_template" };
  }

  const { data: invoice } = await admin
    .from("invoices")
    .select("id, invoice_number, total")
    .eq("booking_id", bookingId)
    .maybeSingle();

  const total = Number(invoice?.total ?? booking.price ?? 0);
  if (total <= 0 && !invoice?.invoice_number) {
    return null;
  }

  return sendBotmakerWhatsApp(admin, {
    phone: booking.customer_phone,
    customer_name: booking.customer_name,
    booking_id: bookingId,
    invoice_id: invoice?.id ?? null,
    template_key: "payment_confirmed",
    message: buildPaymentConfirmedMessage(
      booking,
      invoice?.invoice_number ?? null,
      total,
    ),
  });
}
