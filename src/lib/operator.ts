import { supabase } from "@/integrations/supabase/client";
import { bookingStatusLabels, paymentStatusLabels } from "@/lib/booking-badges";

export type OperatorProfile = {
  staff_id: string;
  user_id: string;
  email: string;
  role: string;
  active: boolean;
};

export type OperatorBooking = {
  id: string;
  customer_name: string;
  customer_phone: string;
  service_name: string;
  vehicle_type: string;
  scheduled_date: string;
  scheduled_time: string;
  booking_status: string;
  payment_status: string;
  payment_method: string;
  price: number;
  address: string;
  formatted_address: string | null;
  neighborhood: string;
  coverage_zone_name: string | null;
  notes: string | null;
  operator_notes: string | null;
  selected_extras: unknown;
  assigned_operator_id: string | null;
  assigned_vehicle_label: string | null;
};

export const OPERATOR_BOOKING_SELECT =
  "id,customer_name,customer_phone,service_name,vehicle_type,scheduled_date,scheduled_time,booking_status,payment_status,payment_method,price,address,formatted_address,neighborhood,coverage_zone_name,notes,operator_notes,selected_extras,assigned_operator_id,assigned_vehicle_label";

export async function fetchMyOperatorProfile(): Promise<{
  profile: OperatorProfile | null;
  error: string | null;
}> {
  const { data, error } = await (supabase as unknown as {
    rpc: (fn: string) => Promise<{ data: OperatorProfile[] | OperatorProfile | null; error: { message: string } | null }>;
  }).rpc("get_my_operator_profile");
  if (error) return { profile: null, error: error.message };
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return { profile: null, error: null };
  return { profile: row as OperatorProfile, error: null };
}

export function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function addDaysIso(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function formatOpTime(time: string) {
  return time?.slice(0, 5) ?? "";
}

export function formatOpDate(iso: string) {
  if (!iso) return "—";
  const [y, m, day] = iso.split("-").map(Number);
  return new Date(y, m - 1, day).toLocaleDateString("es-AR", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

export function customerFirstName(full: string) {
  return full.trim().split(/\s+/)[0] || full;
}

export function paymentInstruction(b: Pick<OperatorBooking, "payment_status" | "payment_method">) {
  if (b.payment_status === "paid") return { label: "Pagado", tone: "paid" as const };
  if (b.payment_method === "Pagar después") {
    return { label: "Cobrar al finalizar", tone: "collect" as const };
  }
  if (b.payment_method === "Transferencia") {
    return { label: "Pendiente de confirmar transferencia", tone: "pending" as const };
  }
  if (b.payment_method === "MercadoPago") {
    return { label: "Pago online pendiente", tone: "pending" as const };
  }
  return {
    label: paymentStatusLabels[b.payment_status] ?? b.payment_status,
    tone: "pending" as const,
  };
}

export function mapsUrl(b: OperatorBooking) {
  const q = encodeURIComponent(b.formatted_address || `${b.address}, ${b.neighborhood}`);
  return `https://www.google.com/maps/search/?api=1&query=${q}`;
}

export function wazeUrl(b: OperatorBooking) {
  const q = encodeURIComponent(b.formatted_address || `${b.address}, ${b.neighborhood}`);
  return `https://waze.com/ul?q=${q}&navigate=yes`;
}

export function whatsappClientUrl(phone: string) {
  const digits = phone.replace(/\D/g, "");
  const normalized = digits.startsWith("54") ? digits : `54${digits}`;
  return `https://wa.me/${normalized}`;
}

export type OperatorUpdateAction = "start" | "complete" | "mark_paid" | "report_issue";

export type OperatorUpdateResponse = {
  ok: boolean;
  status?: string;
  message?: string;
  booking_status?: string;
  payment_status?: string;
  invoice_id?: string | null;
  invoice_created?: boolean;
  already_paid?: boolean;
};

export async function invokeOperatorUpdateBooking(payload: {
  booking_id: string;
  action: OperatorUpdateAction;
  issue_note?: string | null;
  mark_paid?: boolean;
}): Promise<OperatorUpdateResponse> {
  const { data, error } = await supabase.functions.invoke("operator-update-booking", { body: payload });
  if (error) return { ok: false, status: "server_error", message: error.message };
  return (data ?? { ok: false, status: "server_error" }) as OperatorUpdateResponse;
}

export function statusLabel(status: string) {
  return bookingStatusLabels[status] ?? status;
}
