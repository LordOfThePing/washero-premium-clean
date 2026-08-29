// @ts-nocheck -- ported verbatim from supabase/functions; not our source of truth for types
// Admin/manual outbound WhatsApp — sends through the selected transport (Botmaker or Cloud API).
import { createClient } from "@supabase/supabase-js";
import { sendTextViaTransport } from "../_shared/whatsapp-automation.ts";
import {
  buildBookingCreatedMessage,
  buildBookingReminderMessage,
  buildPaymentConfirmedMessage,
  fetchBookingForNotify,
} from "../_shared/whatsapp-automation.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY!;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

async function isActiveAdmin(authHeader: string | null): Promise<boolean> {
  if (!authHeader) return false;
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data } = await userClient.auth.getUser();
  if (!data.user) return false;
  const { data: row } = await admin
    .from("admin_users")
    .select("active, role")
    .eq("user_id", data.user.id)
    .maybeSingle();
  return !!row?.active && ["owner", "admin"].includes(row.role ?? "");
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type Payload = {
  phone?: string;
  customer_name?: string | null;
  message?: string;
  booking_id?: string | null;
  invoice_id?: string | null;
  template_key?: string | null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  if (!(await isActiveAdmin(req.headers.get("authorization")))) {
    return json({ ok: false, error: "forbidden" }, 403);
  }

  let body: Payload;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  const templateKey = (body.template_key ?? "").trim() || null;
  const bookingId = (body.booking_id ?? "").trim() || null;
  let phone = (body.phone ?? "").trim();
  let customerName = body.customer_name ?? null;
  let message = (body.message ?? "").trim();

  if (bookingId && templateKey) {
    const booking = await fetchBookingForNotify(admin, bookingId);
    if (!booking) return json({ ok: false, error: "booking_not_found" }, 404);
    if (!phone) phone = booking.customer_phone;
    if (!customerName) customerName = booking.customer_name;

    if (templateKey === "booking_created") {
      message = buildBookingCreatedMessage(booking);
    } else if (templateKey === "payment_confirmed") {
      const { data: invoice } = await admin
        .from("invoices")
        .select("id, invoice_number, total")
        .eq("booking_id", bookingId)
        .maybeSingle();
      message = buildPaymentConfirmedMessage(
        booking,
        invoice?.invoice_number ?? null,
        Number(invoice?.total ?? booking.price ?? 0),
      );
    } else if (templateKey === "booking_reminder_tomorrow") {
      message = buildBookingReminderMessage(booking);
    }
  }

  if (!phone || !message) {
    return json({ ok: false, error: "missing_phone_or_message" }, 400);
  }

  const result = await sendTextViaTransport(admin, {
    phone,
    message,
    bookingId,
    templateKey: templateKey ?? "manual",
    customerName,
  });

  return json({
    ok: result.ok,
    status: result.status,
    provider_message_id: result.provider_message_id ?? null,
    error: result.error ?? null,
    log_id: result.log_id ?? null,
    // NOTE: request/response diagnostics are transport-specific and intentionally omitted for
    // parity across transports; they remain visible in communication_logs.raw_payload.
  });
});
