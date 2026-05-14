// Supabase Edge Function: create-website-booking
// Secure server-side booking creation with capacity + duplicate checks.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const VEHICLE_TYPES = ["Auto", "SUV", "Pick-up", "Otro"] as const;
const PAYMENT_METHODS = ["Pagar después", "Transferencia"] as const;

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
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}
function isDate(v: string) { return /^\d{4}-\d{2}-\d{2}$/.test(v); }
function isTime(v: string) { return /^\d{2}:\d{2}(:\d{2})?$/.test(v); }
function normTime(v: string) { return v.length === 5 ? `${v}:00` : v; }

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

  // Normalize
  const customer_name = (body.customer_name ?? "").trim();
  const customer_phone = (body.customer_phone ?? "").trim();
  const customer_email = body.customer_email ? body.customer_email.trim().toLowerCase() : null;
  const address = (body.address ?? "").trim();
  const neighborhood = (body.neighborhood ?? "").trim();
  const vehicle_type = (body.vehicle_type ?? "").trim();
  const service_id = (body.service_id ?? "").trim();
  const scheduled_date = (body.scheduled_date ?? "").trim();
  const scheduled_time_raw = (body.scheduled_time ?? "").trim();
  const payment_method = (body.payment_method ?? "").trim();
  const notes = body.notes ? String(body.notes).trim() : null;

  // Validate
  const missing: string[] = [];
  if (!customer_name) missing.push("customer_name");
  if (!customer_phone) missing.push("customer_phone");
  if (!address) missing.push("address");
  if (!neighborhood) missing.push("neighborhood");
  if (!vehicle_type) missing.push("vehicle_type");
  if (!service_id) missing.push("service_id");
  if (!scheduled_date) missing.push("scheduled_date");
  if (!scheduled_time_raw) missing.push("scheduled_time");
  if (!payment_method) missing.push("payment_method");
  if (missing.length) {
    return json({ ok: false, status: "invalid_payload", missing, customer_message: "Faltan datos para crear la reserva." }, 400);
  }
  if (!isUuid(service_id)) return json({ ok: false, status: "invalid_service_id", customer_message: "Servicio inválido." }, 400);
  if (!(VEHICLE_TYPES as readonly string[]).includes(vehicle_type))
    return json({ ok: false, status: "invalid_vehicle_type", customer_message: "Tipo de vehículo inválido." }, 400);
  if (!(PAYMENT_METHODS as readonly string[]).includes(payment_method))
    return json({ ok: false, status: "invalid_payment_method", customer_message: "Método de pago inválido." }, 400);
  if (!isDate(scheduled_date)) return json({ ok: false, status: "invalid_date", customer_message: "Fecha inválida." }, 400);
  if (!isTime(scheduled_time_raw)) return json({ ok: false, status: "invalid_time", customer_message: "Horario inválido." }, 400);
  if (customer_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer_email))
    return json({ ok: false, status: "invalid_email", customer_message: "Email inválido." }, 400);

  const todayStr = new Date().toISOString().slice(0, 10);
  if (scheduled_date < todayStr)
    return json({ ok: false, status: "past_date", customer_message: "La fecha debe ser hoy o posterior." }, 400);

  const scheduled_time = normTime(scheduled_time_raw);

  // Service
  const { data: service, error: svcErr } = await admin
    .from("services")
    .select("id,name,base_price,duration_minutes,active")
    .eq("id", service_id)
    .maybeSingle();
  if (svcErr) return json({ ok: false, status: "server_error", customer_message: "Error del servidor." }, 500);
  if (!service || !service.active)
    return json({ ok: false, status: "invalid_service", customer_message: "El servicio seleccionado no está disponible en este momento." }, 400);

  // Service area
  const { data: areaRows } = await admin
    .from("service_areas")
    .select("id,name")
    .eq("active", true);
  const areaMatch = (areaRows ?? []).some(
    (a: { name: string }) => a.name.trim().toLowerCase() === neighborhood.toLowerCase(),
  );
  const booking_status: "pending" | "needs_review" = areaMatch ? "pending" : "needs_review";

  // Availability slot
  const { data: slot, error: slotErr } = await admin
    .from("availability_slots")
    .select("id,date,start_time,capacity,active")
    .eq("date", scheduled_date)
    .eq("start_time", scheduled_time)
    .eq("active", true)
    .maybeSingle();
  if (slotErr) return json({ ok: false, status: "server_error", customer_message: "Error del servidor." }, 500);
  if (!slot)
    return json({ ok: false, status: "slot_unavailable", customer_message: "Ese horario ya no está disponible. Elegí otro día u horario." }, 409);

  // Capacity
  const { count: takenCount, error: cntErr } = await admin
    .from("bookings")
    .select("id", { count: "exact", head: true })
    .eq("scheduled_date", scheduled_date)
    .eq("scheduled_time", scheduled_time)
    .neq("booking_status", "cancelled");
  if (cntErr) return json({ ok: false, status: "server_error", customer_message: "Error del servidor." }, 500);
  if ((takenCount ?? 0) >= slot.capacity)
    return json({ ok: false, status: "slot_full", customer_message: "Ese horario ya se completó. Elegí otro día u horario." }, 409);

  // Duplicate
  const { data: dup } = await admin
    .from("bookings")
    .select("id")
    .eq("customer_phone", customer_phone)
    .eq("scheduled_date", scheduled_date)
    .eq("scheduled_time", scheduled_time)
    .neq("booking_status", "cancelled")
    .limit(1);
  if (dup && dup.length > 0)
    return json({ ok: false, status: "duplicate", customer_message: "Ya tenemos una reserva registrada para ese teléfono en ese día y horario. Si querés modificarla, escribinos por WhatsApp." }, 409);

  // Customer sync
  const { data: existing } = await admin
    .from("customers")
    .select("id")
    .eq("phone", customer_phone)
    .limit(1)
    .maybeSingle();

  let customer_id: string | null = null;
  if (existing?.id) {
    customer_id = existing.id;
    await admin
      .from("customers")
      .update({
        full_name: customer_name,
        email: customer_email,
        address,
        neighborhood,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id);
  } else {
    const { data: ins } = await admin
      .from("customers")
      .insert({
        full_name: customer_name,
        phone: customer_phone,
        email: customer_email,
        address,
        neighborhood,
      })
      .select("id")
      .maybeSingle();
    customer_id = ins?.id ?? null;
  }

  // Booking insert
  const { data: created, error: insErr } = await admin
    .from("bookings")
    .insert({
      customer_id,
      customer_name,
      customer_phone,
      customer_email,
      address,
      neighborhood,
      vehicle_type,
      service_id: service.id,
      service_name: service.name,
      scheduled_date,
      scheduled_time,
      duration_minutes: service.duration_minutes,
      price: service.base_price,
      payment_method,
      payment_status: "pending",
      booking_status,
      booking_source: "website",
      notes,
    })
    .select("id,booking_status")
    .maybeSingle();

  if (insErr || !created) {
    console.error("booking insert failed", insErr);
    return json({ ok: false, status: "server_error", customer_message: "No pudimos crear la reserva. Probá de nuevo." }, 500);
  }

  return json({
    ok: true,
    status: "booking_created",
    booking_id: created.id,
    booking_status: created.booking_status,
    customer_message: "Reserva recibida 🚗✨ Te vamos a confirmar los detalles por WhatsApp.",
    summary: {
      service_name: service.name,
      scheduled_date,
      scheduled_time,
      address,
      neighborhood,
      price: service.base_price,
    },
  });
});
