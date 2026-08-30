import { supabase } from "@/integrations/supabase/client";

export type PaymentReceiptStatus =
  | "pending_review"
  | "approved"
  | "rejected"
  | "unresolved";

export type PaymentReceiptRow = {
  id: string;
  booking_id: string | null;
  customer_phone: string | null;
  source: string;
  whatsapp_message_id: string | null;
  media_url: string | null;
  storage_bucket: string;
  storage_path: string | null;
  mime_type: string | null;
  file_name: string | null;
  file_size: number | null;
  status: PaymentReceiptStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  notes: string | null;
  raw_payload: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  bookings?: {
    id: string;
    customer_name: string;
    scheduled_date: string;
    scheduled_time: string;
    price: number;
    payment_method: string;
    booking_status: string;
    payment_status: string;
  } | null;
};

export const paymentReceiptStatusLabels: Record<PaymentReceiptStatus, string> = {
  pending_review: "Pendiente de revisión",
  approved: "Aprobado",
  rejected: "Rechazado",
  unresolved: "Sin reserva vinculada",
};

export async function fetchPaymentReceipts(): Promise<PaymentReceiptRow[]> {
  const { data, error } = await supabase
    .from("payment_receipts")
    .select(
      "*, bookings(id, customer_name, scheduled_date, scheduled_time, price, payment_method, booking_status, payment_status)",
    )
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw error;
  return (data ?? []) as PaymentReceiptRow[];
}

export async function invokeApprovePaymentReceipt(body: {
  receipt_id: string;
  action: "approve" | "reject" | "link_booking";
  notes?: string | null;
  booking_id?: string | null;
}) {
  const { data, error } = await supabase.functions.invoke("approve-payment-receipt", { body });
  if (error) throw new Error(error.message);
  return data as {
    ok: boolean;
    error?: string;
    status?: string;
    whatsapp_scheduled?: boolean;
    already_approved?: boolean;
  };
}

export async function fetchPaymentReceiptSignedUrl(receiptId: string) {
  const { data, error } = await supabase.functions.invoke("get-payment-receipt-signed-url", {
    body: { receipt_id: receiptId },
  });
  if (error) throw new Error(error.message);
  return data as {
    ok: boolean;
    signed_url?: string | null;
    fallback_media_url?: boolean;
    mime_type?: string | null;
    file_name?: string | null;
    error?: string;
  };
}
