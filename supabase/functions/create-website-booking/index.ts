// Supabase Edge Function: create-website-booking
// Secure server-side booking creation; uses shared booking-core helper.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { tryCreateBooking } from "../_shared/booking-core.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PROJECT_REF = "domslcbxgqbylmciqrxt";
const SITE_ORIGIN = Deno.env.get("PUBLIC_SITE_URL") ?? "https://washero-premium-clean.lovable.app";
const WEBHOOK_URL = `https://${PROJECT_REF}.supabase.co/functions/v1/mercadopago-webhook`;

type Payload = {
  customer_name?: string;
  customer_phone?: string;
  customer_email?: string | null;
  address?: string;
  neighborhood?: string;
  vehicle_type?: string;
  service_id?: string;
  scheduled_date?: string;
  scheduled_time?: string;
  payment_method?: string;
  notes?: string | null;
  selected_extras?: string[];
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, status: "method_not_allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  let body: Payload;
  try { body = await req.json(); } catch {
    return json({ ok: false, status: "invalid_json", customer_message: "Solicitud inválida." }, 400);
  }

  if (body.customer_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(body.customer_email).trim()))
    return json({ ok: false, status: "invalid_email", customer_message: "Email inválido." }, 400);

  const result = await tryCreateBooking(admin, {
    customer_name: body.customer_name ?? "",
    customer_phone: body.customer_phone ?? "",
    customer_email: body.customer_email ?? null,
    address: body.address ?? "",
    neighborhood: body.neighborhood ?? "",
    vehicle_type: body.vehicle_type ?? "",
    service_id: body.service_id ?? null,
    scheduled_date: body.scheduled_date ?? "",
    scheduled_time: body.scheduled_time ?? "",
    payment_method: body.payment_method ?? "",
    notes: body.notes ?? null,
    selected_extras: body.selected_extras ?? [],
    source: "website",
  });

  if (!result.ok) {
    const map: Record<string, string> = {
      missing_fields: "Faltan datos para crear la reserva.",
      invalid_service: "El servicio seleccionado no está disponible.",
      invalid_vehicle: "Tipo de vehículo inválido.",
      invalid_payment: "Método de pago inválido.",
      invalid_date: "Fecha inválida.",
      invalid_time: "Horario inválido.",
      past_date: "La fecha debe ser hoy o posterior.",
      invalid_extra: "Hay un extra inválido. Actualizá la página e intentá nuevamente.",
      slot_unavailable: "Ese horario ya no está disponible. Elegí otro día u horario.",
      slot_full: "Ese horario ya se completó. Elegí otro día u horario.",
      duplicate: "Ya tenemos una reserva registrada para ese teléfono en ese día y horario.",
      server_error: "No pudimos crear la reserva. Probá de nuevo.",
    };
    return json({
      ok: false,
      status: result.reason,
      missing: result.reason === "missing_fields" ? result.missing : undefined,
      customer_message: map[result.reason] ?? result.message,
    }, result.http_status);
  }

  const { booking, service } = result;
  const baseSummary = {
    service_name: booking.service_name,
    scheduled_date: booking.scheduled_date,
    scheduled_time: booking.scheduled_time,
    address: booking.address,
    neighborhood: booking.neighborhood,
    price: booking.price,
  };
  const baseResponse = {
    ok: true,
    booking_id: booking.id,
    booking_status: booking.booking_status,
    payment_status: "pending",
    summary: baseSummary,
  };

  // Mercado Pago path
  if (booking.payment_method === "MercadoPago") {
    const MP_TOKEN = Deno.env.get("MERCADOPAGO_ACCESS_TOKEN");
    if (!MP_TOKEN) {
      console.error("MercadoPago selected but MERCADOPAGO_ACCESS_TOKEN missing");
      return json({
        ...baseResponse,
        status: "booking_created_payment_setup_failed",
        customer_message:
          "Recibimos tu reserva, pero no pudimos abrir Mercado Pago. Te vamos a contactar por WhatsApp para coordinar el pago.",
      });
    }

    const preferenceBody = {
      items: [{
        title: `Washero - ${service.name}`,
        quantity: 1,
        currency_id: "ARS",
        unit_price: booking.price,
      }],
      payer: {
        name: booking.customer_name,
        email: booking.customer_email ?? undefined,
      },
      external_reference: booking.id,
      metadata: {
        booking_id: booking.id,
        customer_phone: booking.customer_phone,
        service_name: service.name,
        scheduled_date: booking.scheduled_date,
        scheduled_time: booking.scheduled_time,
      },
      back_urls: {
        success: `${SITE_ORIGIN}/gracias?payment=success`,
        pending: `${SITE_ORIGIN}/gracias?payment=pending`,
        failure: `${SITE_ORIGIN}/gracias?payment=failure`,
      },
      auto_return: "approved",
      notification_url: WEBHOOK_URL,
      statement_descriptor: "WASHERO",
    };

    let preference: Record<string, unknown> | null = null;
    try {
      const res = await fetch("https://api.mercadopago.com/checkout/preferences", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${MP_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(preferenceBody),
      });
      if (!res.ok) {
        const txt = await res.text();
        console.error("MP preference failed", res.status, txt);
      } else {
        preference = await res.json();
      }
    } catch (e) {
      console.error("MP preference exception", e);
    }

    await admin.from("payments").insert({
      booking_id: booking.id,
      provider: "mercadopago",
      provider_payment_id: (preference?.id as string | undefined) ?? null,
      amount: booking.price,
      status: "pending",
      raw_payload: preference ?? { error: "preference_creation_failed" },
    });

    if (!preference) {
      return json({
        ...baseResponse,
        status: "booking_created_payment_setup_failed",
        customer_message:
          "Recibimos tu reserva, pero no pudimos abrir Mercado Pago. Te vamos a contactar por WhatsApp para coordinar el pago.",
      });
    }

    const checkoutUrl =
      (preference.init_point as string | undefined) ??
      (preference.sandbox_init_point as string | undefined) ??
      null;

    return json({
      ...baseResponse,
      status: "booking_created_payment_pending",
      checkout_url: checkoutUrl,
      customer_message: "Reserva recibida. Te redirigimos a Mercado Pago para completar el pago.",
    });
  }

  return json({
    ...baseResponse,
    status: "booking_created",
    customer_message: "Reserva recibida 🚗✨ Te vamos a confirmar los detalles por WhatsApp.",
  });
});
