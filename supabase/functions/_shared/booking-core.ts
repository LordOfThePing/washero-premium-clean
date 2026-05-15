// Shared booking creation logic used by create-website-booking and botmaker-webhook.
// Uses an admin (service-role) Supabase client; never expose this to clients.

// deno-lint-ignore-file no-explicit-any
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

export const VEHICLE_TYPES = ["Auto", "SUV", "Pick-up", "Otro"] as const;
export const PAYMENT_METHODS = ["Pagar después", "Transferencia", "MercadoPago"] as const;

export const VEHICLE_SURCHARGES: Record<string, number> = {
  "Auto": 0,
  "SUV": 5000,
  "Pick-up": 8000,
  "Otro": 0,
};

export const ALLOWED_EXTRAS: Record<string, { label: string; price: number }> = {
  encerado_rapido:            { label: "Encerado rápido",             price: 8000 },
  detallado_interior_profundo:{ label: "Detallado interior profundo",  price: 9000 },
  eliminacion_olores:         { label: "Eliminación de olores",        price: 12000 },
  barro_auto_muy_sucio:       { label: "Barro / Auto muy sucio",       price: 7000 },
  pelo_mascotas:              { label: "Pelo de mascotas",             price: 10000 },
};

export type CoreBookingInput = {
  customer_name: string;
  customer_phone: string;
  customer_email?: string | null;
  address: string;
  neighborhood: string;
  vehicle_type: string;       // must be in VEHICLE_TYPES
  service_id?: string | null; // optional if service_name provided
  service_name?: string | null; // botmaker fallback
  scheduled_date: string;     // YYYY-MM-DD
  scheduled_time: string;     // HH:MM or HH:MM:SS
  payment_method: string;     // must be in PAYMENT_METHODS
  notes?: string | null;
  selected_extras?: string[]; // ids from ALLOWED_EXTRAS
  source: "website" | "botmaker";
  is_test?: boolean;
};

export type CoreResult =
  | {
      ok: true;
      booking: {
        id: string;
        booking_status: string;
        price: number;
        service_id: string;
        service_name: string;
        scheduled_date: string;
        scheduled_time: string;
        address: string;
        neighborhood: string;
        vehicle_type: string;
        payment_method: string;
        customer_name: string;
        customer_phone: string;
        customer_email: string | null;
        customer_id: string | null;
      };
      service: { id: string; name: string; base_price: number; duration_minutes: number };
      surcharge: number;
      extras_total: number;
      area_match: boolean;
    }
  | {
      ok: false;
      reason:
        | "missing_fields"
        | "invalid_service"
        | "invalid_vehicle"
        | "invalid_payment"
        | "invalid_date"
        | "invalid_time"
        | "past_date"
        | "invalid_extra"
        | "slot_unavailable"
        | "slot_full"
        | "duplicate"
        | "server_error";
      missing?: string[];
      message: string;
      http_status: number;
    };

function isDate(v: string) { return /^\d{4}-\d{2}-\d{2}$/.test(v); }
function isTime(v: string) { return /^\d{2}:\d{2}(:\d{2})?$/.test(v); }
function normTime(v: string) { return v.length === 5 ? `${v}:00` : v; }

export async function tryCreateBooking(
  admin: SupabaseClient,
  input: CoreBookingInput,
): Promise<CoreResult> {
  const customer_name = (input.customer_name ?? "").trim();
  const customer_phone = (input.customer_phone ?? "").trim();
  const customer_email = input.customer_email ? String(input.customer_email).trim().toLowerCase() : null;
  const address = (input.address ?? "").trim();
  const neighborhood = (input.neighborhood ?? "").trim();
  const vehicle_type = (input.vehicle_type ?? "").trim();
  const service_id = input.service_id ? String(input.service_id).trim() : "";
  const service_name = input.service_name ? String(input.service_name).trim() : "";
  const scheduled_date = (input.scheduled_date ?? "").trim();
  const scheduled_time_raw = (input.scheduled_time ?? "").trim();
  const payment_method = (input.payment_method ?? "").trim();
  const notes_in = input.notes ? String(input.notes).trim() : "";
  const selected_extras = Array.isArray(input.selected_extras) ? input.selected_extras : [];

  const missing: string[] = [];
  if (!customer_name) missing.push("customer_name");
  if (!customer_phone) missing.push("customer_phone");
  if (!address) missing.push("address");
  if (!neighborhood) missing.push("neighborhood");
  if (!vehicle_type) missing.push("vehicle_type");
  if (!service_id && !service_name) missing.push("service");
  if (!scheduled_date) missing.push("scheduled_date");
  if (!scheduled_time_raw) missing.push("scheduled_time");
  if (!payment_method) missing.push("payment_method");
  if (missing.length) return { ok: false, reason: "missing_fields", missing, message: "Faltan datos.", http_status: 400 };

  if (!(VEHICLE_TYPES as readonly string[]).includes(vehicle_type))
    return { ok: false, reason: "invalid_vehicle", message: "Tipo de vehículo inválido.", http_status: 400 };
  if (!(PAYMENT_METHODS as readonly string[]).includes(payment_method))
    return { ok: false, reason: "invalid_payment", message: "Método de pago inválido.", http_status: 400 };
  if (!isDate(scheduled_date)) return { ok: false, reason: "invalid_date", message: "Fecha inválida.", http_status: 400 };
  if (!isTime(scheduled_time_raw)) return { ok: false, reason: "invalid_time", message: "Horario inválido.", http_status: 400 };

  const todayStr = new Date().toISOString().slice(0, 10);
  if (scheduled_date < todayStr) return { ok: false, reason: "past_date", message: "La fecha debe ser hoy o posterior.", http_status: 400 };

  const scheduled_time = normTime(scheduled_time_raw);

  // Validate extras (allowlist)
  const unknown_extras = selected_extras.filter((e) => !ALLOWED_EXTRAS[e]);
  if (unknown_extras.length) {
    return { ok: false, reason: "invalid_extra", message: "Hay un extra inválido. Actualizá la página e intentá nuevamente.", http_status: 400 };
  }

  // Service lookup
  let service: { id: string; name: string; base_price: number; duration_minutes: number; active: boolean } | null = null;
  if (service_id) {
    const { data } = await admin.from("services")
      .select("id,name,base_price,duration_minutes,active")
      .eq("id", service_id).maybeSingle();
    service = data as any;
  } else if (service_name) {
    const { data } = await admin.from("services")
      .select("id,name,base_price,duration_minutes,active")
      .ilike("name", service_name).eq("active", true).maybeSingle();
    service = data as any;
  }
  if (!service || !service.active)
    return { ok: false, reason: "invalid_service", message: "El servicio no está disponible.", http_status: 400 };

  // Area match
  const { data: areaRows } = await admin.from("service_areas").select("name").eq("active", true);
  const area_match = (areaRows ?? []).some((a: any) => a.name.trim().toLowerCase() === neighborhood.toLowerCase());

  // Slot lookup
  const { data: slot } = await admin.from("availability_slots")
    .select("id,date,start_time,capacity,active")
    .eq("date", scheduled_date)
    .eq("start_time", scheduled_time)
    .eq("active", true)
    .maybeSingle();
  if (!slot) return { ok: false, reason: "slot_unavailable", message: "Ese horario ya no está disponible.", http_status: 409 };

  // Capacity
  const { count: takenCount } = await admin.from("bookings")
    .select("id", { count: "exact", head: true })
    .eq("scheduled_date", scheduled_date)
    .eq("scheduled_time", scheduled_time)
    .neq("booking_status", "cancelled");
  if ((takenCount ?? 0) >= (slot as any).capacity)
    return { ok: false, reason: "slot_full", message: "Ese horario ya se completó.", http_status: 409 };

  // Duplicate
  const { data: dup } = await admin.from("bookings").select("id")
    .eq("customer_phone", customer_phone)
    .eq("scheduled_date", scheduled_date)
    .eq("scheduled_time", scheduled_time)
    .neq("booking_status", "cancelled").limit(1);
  if (dup && dup.length) return { ok: false, reason: "duplicate", message: "Ya existe una reserva en ese horario para este teléfono.", http_status: 409 };

  // Pricing
  const surcharge = VEHICLE_SURCHARGES[vehicle_type] ?? 0;
  let extras_total = 0;
  const extras_lines: string[] = [];
  for (const id of selected_extras) {
    const e = ALLOWED_EXTRAS[id];
    extras_total += e.price;
    extras_lines.push(`${e.label} (+$${e.price})`);
  }
  const total_price = service.base_price + surcharge + extras_total;

  // Customer sync
  const { data: existing } = await admin.from("customers").select("id").eq("phone", customer_phone).limit(1).maybeSingle();
  let customer_id: string | null = null;
  if (existing?.id) {
    customer_id = existing.id;
    await admin.from("customers").update({
      full_name: customer_name,
      email: customer_email,
      address,
      neighborhood,
      updated_at: new Date().toISOString(),
    }).eq("id", existing.id);
  } else {
    const { data: ins } = await admin.from("customers").insert({
      full_name: customer_name, phone: customer_phone, email: customer_email, address, neighborhood,
    }).select("id").maybeSingle();
    customer_id = ins?.id ?? null;
  }

  // Build notes
  const notes_parts: string[] = [];
  if (notes_in) notes_parts.push(notes_in);
  if (vehicle_type && surcharge > 0) notes_parts.push(`Vehículo: ${vehicle_type} (+$${surcharge})`);
  if (extras_lines.length) notes_parts.push(`Extras: ${extras_lines.join(", ")}`);
  if (input.is_test) notes_parts.push("[TEST]");
  const notes = notes_parts.length ? notes_parts.join(" | ") : null;

  // Booking status
  let booking_status: "pending" | "confirmed" | "needs_review" =
    input.source === "botmaker" ? "confirmed" : (area_match ? "pending" : "needs_review");
  if (vehicle_type === "Otro") booking_status = "needs_review";

  const { data: created, error: insErr } = await admin.from("bookings").insert({
    customer_id,
    customer_name, customer_phone, customer_email,
    address, neighborhood, vehicle_type,
    service_id: service.id, service_name: service.name,
    scheduled_date, scheduled_time,
    duration_minutes: service.duration_minutes,
    price: total_price,
    payment_method,
    payment_status: "pending",
    booking_status,
    booking_source: input.source,
    notes,
  }).select("id,booking_status,price").maybeSingle();

  if (insErr || !created) {
    console.error("[booking-core] insert failed", insErr);
    return { ok: false, reason: "server_error", message: "No pudimos crear la reserva.", http_status: 500 };
  }

  return {
    ok: true,
    booking: {
      id: created.id,
      booking_status: created.booking_status,
      price: created.price,
      service_id: service.id,
      service_name: service.name,
      scheduled_date,
      scheduled_time,
      address,
      neighborhood,
      vehicle_type,
      payment_method,
      customer_name,
      customer_phone,
      customer_email,
      customer_id,
    },
    service,
    surcharge,
    extras_total,
    area_match,
  };
}
