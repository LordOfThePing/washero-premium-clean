import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  normalizeArgentinaWhatsAppPhone,
  sendBotmakerWhatsApp,
} from "../_shared/botmaker-outbound.ts";
import { getOperatorGate, isStrictOperatorRole } from "../_shared/operator-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
const PUBLIC_SITE_URL = (Deno.env.get("PUBLIC_SITE_URL") ?? "https://washero.ar").replace(/\/+$/, "");
const ALLOW_UNASSIGNED_TODAY = String(Deno.env.get("OPERATOR_ALLOW_UNASSIGNED_TODAY") ?? "false").toLowerCase() === "true";
const ALLOW_FALLBACK_TEXT = String(Deno.env.get("OPERATOR_WHATSAPP_ALLOW_FALLBACK_TEXT") ?? "false").toLowerCase() === "true";

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

type ActionKey =
  | "operator_on_the_way"
  | "operator_arrived"
  | "operator_delayed"
  | "operator_access_needed"
  | "operator_wash_completed"
  | "operator_payment_reminder";

type Payload = {
  booking_id?: string;
  action_key?: ActionKey;
  eta_minutes?: number | null;
  message_text?: string | null;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function firstName(full: string) {
  return full.trim().split(/\s+/)[0] || full;
}

function formatDate(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("es-AR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

function formatTime(time: string) {
  return String(time ?? "").slice(0, 5);
}

function customerInvoiceUrl(publicToken: string | null | undefined) {
  const token = String(publicToken ?? "").trim();
  if (!token) return null;
  return `${PUBLIC_SITE_URL}/comprobante/${token}`;
}

async function hasOpenConversationWindow(phone: string) {
  const normalized = normalizeArgentinaWhatsAppPhone(phone);
  if (!normalized) return false;
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data } = await admin
    .from("botmaker_messages")
    .select("id")
    .eq("customer_phone", normalized)
    .eq("direction", "inbound")
    .gte("created_at", cutoff)
    .limit(1);
  return (data?.length ?? 0) > 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, status: "method_not_allowed" }, 405);

  const gate = await getOperatorGate({
    authHeader: req.headers.get("authorization"),
    supabaseUrl: SUPABASE_URL,
    anonKey: ANON_KEY,
    admin,
  });
  if (!gate.ok) {
    return json({ ok: false, status: "forbidden", message: "No autorizado." }, 403);
  }

  let body: Payload;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, status: "invalid_json", message: "Solicitud inválida." }, 400);
  }

  const bookingId = String(body.booking_id ?? "").trim();
  const actionKey = body.action_key as ActionKey | undefined;
  const etaMinutes = Number(body.eta_minutes ?? 20);
  const fallbackText = String(body.message_text ?? "").trim();
  if (!bookingId) {
    return json({ ok: false, status: "missing_booking_id", message: "Falta booking_id." }, 400);
  }

  const { data: booking, error: bookingError } = await admin
    .from("bookings")
    .select("id,assigned_operator_id,scheduled_date,scheduled_time,customer_name,customer_phone,formatted_address,address,payment_status")
    .eq("id", bookingId)
    .maybeSingle();
  if (bookingError || !booking) {
    return json({ ok: false, status: "booking_not_found", message: "Reserva no encontrada." }, 404);
  }

  const today = new Date().toISOString().slice(0, 10);
  if (isStrictOperatorRole(gate.role)) {
    const allowedUnassignedToday =
      ALLOW_UNASSIGNED_TODAY &&
      !booking.assigned_operator_id &&
      booking.scheduled_date === today;
    const ownAssigned = booking.assigned_operator_id && booking.assigned_operator_id === gate.staffId;
    if (!ownAssigned && !allowedUnassignedToday) {
      return json(
        {
          ok: false,
          status: "booking_forbidden",
          message: "No podés enviar mensajes para esta reserva.",
        },
        403,
      );
    }
  }

  const { data: invoice } = await admin
    .from("invoices")
    .select("public_token,invoice_number")
    .eq("booking_id", booking.id)
    .maybeSingle();
  const receiptUrl = customerInvoiceUrl(invoice?.public_token);

  const vars = {
    firstName: firstName(String(booking.customer_name ?? "cliente")),
    bookingTime: formatTime(String(booking.scheduled_time ?? "")),
    bookingDate: formatDate(String(booking.scheduled_date ?? today)),
    address: String(booking.formatted_address ?? booking.address ?? "tu domicilio"),
    eta: Number.isFinite(etaMinutes) && etaMinutes > 0 ? Math.round(etaMinutes) : 20,
    receiptUrl,
  };

  const templates: Partial<Record<ActionKey, { templateKey: string; text: string }>> = {
    operator_on_the_way: {
      templateKey: "operator_on_the_way",
      text: `Hola ${vars.firstName}, ya estoy en camino para tu lavado de las ${vars.bookingTime}. Llego en aproximadamente ${vars.eta} minutos.`,
    },
    operator_arrived: {
      templateKey: "operator_arrived",
      text: `Hola ${vars.firstName}, ya llegué a ${vars.address}. Cuando puedas, te espero para comenzar el lavado.`,
    },
    operator_delayed: {
      templateKey: "operator_delayed",
      text: `Hola ${vars.firstName}, voy con una demora operativa. Te aviso apenas esté saliendo para allá. Gracias por la paciencia.`,
    },
    operator_access_needed: {
      templateKey: "operator_access_needed",
      text: `Hola ${vars.firstName}, ya estoy en la ubicación y necesito acceso para iniciar el lavado. ¿Me ayudás, por favor?`,
    },
    operator_wash_completed: {
      templateKey: "operator_wash_completed",
      text: `Hola ${vars.firstName}, terminamos tu lavado Washero de hoy (${vars.bookingDate}).${vars.receiptUrl ? ` Podés ver tu comprobante acá: ${vars.receiptUrl}` : ""}`,
    },
    operator_payment_reminder: {
      templateKey: "operator_payment_reminder",
      text: `Hola ${vars.firstName}, te recordamos que el pago de tu lavado sigue pendiente. Si ya abonaste, avisanos por este medio.`,
    },
  };

  let templateKey: string | null = null;
  let message = "";

  if (actionKey && templates[actionKey]) {
    templateKey = templates[actionKey]!.templateKey;
    message = templates[actionKey]!.text;
  } else if (fallbackText) {
    const isWindowOpen = await hasOpenConversationWindow(String(booking.customer_phone ?? ""));
    if (!ALLOW_FALLBACK_TEXT || !isWindowOpen) {
      return json(
        {
          ok: false,
          status: "fallback_text_not_allowed",
          message: "No está permitido enviar texto libre sin ventana activa.",
        },
        422,
      );
    }
    templateKey = null;
    message = fallbackText;
  } else {
    return json({ ok: false, status: "missing_action", message: "Falta acción de mensaje." }, 400);
  }

  const result = await sendBotmakerWhatsApp(admin, {
    phone: String(booking.customer_phone ?? ""),
    customer_name: String(booking.customer_name ?? ""),
    booking_id: booking.id,
    template_key: templateKey,
    message,
  });

  return json({
    ok: result.ok,
    status: result.status,
    message: result.error ?? (result.ok ? "sent" : "failed"),
    template_key: templateKey,
    log_id: result.log_id ?? null,
  }, result.ok ? 200 : 502);
});
