// Shared booking creation logic used by create-website-booking and botmaker-webhook.
// Uses an admin (service-role) Supabase client; never expose this to clients.

// deno-lint-ignore-file no-explicit-any
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { loadActiveZones, matchZone } from "./coverage.ts";

export const VEHICLE_TYPES = ["Auto", "SUV", "Pick-up", "Otro"] as const;
export const PAYMENT_METHODS = ["Pagar después", "Transferencia", "MercadoPago"] as const;

export type CoreBookingInput = {
  customer_name: string;
  customer_phone: string;
  customer_email?: string | null;
  address: string;
  neighborhood: string;
  vehicle_type: string;
  service_id?: string | null;
  service_name?: string | null;
  scheduled_date: string;
  scheduled_time: string;
  payment_method: string;
  notes?: string | null;
  selected_extras?: string[];
  source: "website" | "botmaker" | "admin";
  is_test?: boolean;
  // Optional location fields (Google Places)
  place_id?: string | null;
  formatted_address?: string | null;
  address_lat?: number | null;
  address_lng?: number | null;
  // Coverage policy
  enforce_coverage?: boolean; // website=true, botmaker/admin=false unless coords provided
  /** Admin / approval paths only — must match bookings check constraints */
  requested_booking_status?: string;
  requested_payment_status?: string;
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
      coverage_zone_id: string | null;
      coverage_zone_name: string | null;
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
        | "slot_not_found"
        | "service_does_not_fit_slot"
        | "slot_full"
        | "duplicate"
        | "outside_coverage"
        | "server_error";
      missing?: string[];
      message: string;
      http_status: number;
    };

function isDate(v: string) { return /^\d{4}-\d{2}-\d{2}$/.test(v); }
function isTime(v: string) { return /^\d{2}:\d{2}(:\d{2})?$/.test(v); }
function normTime(v: string) { return v.length === 5 ? `${v}:00` : v; }

async function loadVehicleSurcharge(admin: SupabaseClient, vehicle_type: string): Promise<number> {
  const { data } = await admin.from("pricing_items")
    .select("amount,code,name").eq("type", "vehicle_surcharge").eq("active", true);
  const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const v = fold(vehicle_type);
  for (const row of (data ?? []) as any[]) {
    if (fold(row.code) === v || fold(row.name).includes(v) || v.includes(fold(row.code))) {
      return Number(row.amount) || 0;
    }
  }
  return 0;
}

async function loadExtras(admin: SupabaseClient, codes: string[]): Promise<{ ok: true; total: number; lines: string[] } | { ok: false; missing: string[] }> {
  if (!codes.length) return { ok: true, total: 0, lines: [] };
  const { data } = await admin.from("pricing_items")
    .select("code,name,amount,active").eq("type", "extra").in("code", codes);
  const map = new Map<string, { name: string; amount: number; active: boolean }>();
  for (const r of (data ?? []) as any[]) map.set(r.code, { name: r.name, amount: Number(r.amount) || 0, active: !!r.active });
  const missing = codes.filter((c) => !map.get(c) || !map.get(c)!.active);
  if (missing.length) return { ok: false, missing };
  const lines: string[] = [];
  let total = 0;
  for (const c of codes) {
    const e = map.get(c)!;
    total += e.amount;
    lines.push(`${e.name} (+$${e.amount})`);
  }
  return { ok: true, total, lines };
}

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
  const enforce_coverage = !!input.enforce_coverage;

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

  // Coverage zone match (polygon → alias → radius)
  const zones = await loadActiveZones(admin);
  const cov = matchZone(zones, {
    lat: input.address_lat ?? null,
    lng: input.address_lng ?? null,
    neighborhood,
  });
  const inside_coverage = !!cov.zone;
  if (enforce_coverage && !inside_coverage) {
    return { ok: false, reason: "outside_coverage", message: "Esa dirección está fuera de nuestra zona de cobertura.", http_status: 422 };
  }

  // service_areas legacy area_match (informational)
  const { data: areaRows } = await admin.from("service_areas").select("name").eq("active", true);
  const area_match = (areaRows ?? []).some((a: any) => a.name.trim().toLowerCase() === neighborhood.toLowerCase());

  // Slot lookup
  const { data: slot } = await admin.from("availability_slots")
    .select("id,date,start_time,end_time,capacity,active")
    .eq("date", scheduled_date)
    .eq("start_time", scheduled_time)
    .eq("active", true)
    .maybeSingle();
  if (!slot) return { ok: false, reason: "slot_not_found", message: "Ese horario ya no está disponible.", http_status: 409 };

  const toMin = (t: string) => {
    const [h, m] = String(t).slice(0, 5).split(":").map(Number);
    return h * 60 + m;
  };
  const reqStart = toMin(scheduled_time);
  const reqEnd = reqStart + (service.duration_minutes ?? 0);
  const slotEnd = toMin((slot as any).end_time);
  if (reqEnd > slotEnd) {
    return { ok: false, reason: "service_does_not_fit_slot", message: "El servicio elegido no entra en el horario seleccionado.", http_status: 409 };
  }

  const { data: sameDay } = await admin.from("bookings")
    .select("scheduled_time,duration_minutes,booking_status")
    .eq("scheduled_date", scheduled_date)
    .neq("booking_status", "cancelled");
  let overlapping = 0;
  for (const b of (sameDay ?? []) as any[]) {
    const bStart = toMin(b.scheduled_time);
    const bEnd = bStart + (b.duration_minutes ?? 0);
    if (bStart < reqEnd && bEnd > reqStart) overlapping++;
  }
  if (overlapping >= (slot as any).capacity)
    return { ok: false, reason: "slot_full", message: "Ese horario ya se completó.", http_status: 409 };

  // Duplicate
  const { data: dup } = await admin.from("bookings").select("id")
    .eq("customer_phone", customer_phone)
    .eq("scheduled_date", scheduled_date)
    .eq("scheduled_time", scheduled_time)
    .neq("booking_status", "cancelled").limit(1);
  if (dup && dup.length) return { ok: false, reason: "duplicate", message: "Ya existe una reserva en ese horario para este teléfono.", http_status: 409 };

  // Pricing from DB
  const surcharge = await loadVehicleSurcharge(admin, vehicle_type);
  const extras = await loadExtras(admin, selected_extras);
  if (!extras.ok) return { ok: false, reason: "invalid_extra", message: "Hay un extra inválido. Actualizá la página e intentá nuevamente.", http_status: 400 };
  const extras_total = extras.total;
  const total_price = service.base_price + surcharge + extras_total;

  const price_breakdown = {
    base: { label: service.name, amount: service.base_price },
    vehicle: { type: vehicle_type, amount: surcharge },
    extras: extras.lines,
    extras_total,
    total: total_price,
    lines: [
      { label: service.name, amount: service.base_price },
      ...(surcharge > 0 ? [{ label: `Recargo vehículo (${vehicle_type})`, amount: surcharge }] : []),
      ...extras.lines.map((l) => ({ label: l, amount: 0 })),
    ],
  };

  // Customer sync
  const { data: existing } = await admin.from("customers").select("id").eq("phone", customer_phone).limit(1).maybeSingle();
  let customer_id: string | null = null;
  const customerLoc: any = {};
  if (input.place_id) customerLoc.place_id = input.place_id;
  if (input.formatted_address) customerLoc.formatted_address = input.formatted_address;
  if (typeof input.address_lat === "number") customerLoc.address_lat = input.address_lat;
  if (typeof input.address_lng === "number") customerLoc.address_lng = input.address_lng;
  if (cov.zone) { customerLoc.coverage_zone_id = cov.zone.id; customerLoc.coverage_zone_name = cov.zone.name; }

  if (existing?.id) {
    customer_id = existing.id;
    await admin.from("customers").update({
      full_name: customer_name,
      email: customer_email,
      address,
      neighborhood,
      ...customerLoc,
      updated_at: new Date().toISOString(),
    }).eq("id", existing.id);
  } else {
    const { data: ins } = await admin.from("customers").insert({
      full_name: customer_name, phone: customer_phone, email: customer_email, address, neighborhood, ...customerLoc,
    }).select("id").maybeSingle();
    customer_id = ins?.id ?? null;
  }

  const notes_parts: string[] = [];
  if (notes_in) notes_parts.push(notes_in);
  if (vehicle_type && surcharge > 0) notes_parts.push(`Vehículo: ${vehicle_type} (+$${surcharge})`);
  if (extras.lines.length) notes_parts.push(`Extras: ${extras.lines.join(", ")}`);
  if (input.is_test) notes_parts.push("[TEST]");
  const notes = notes_parts.length ? notes_parts.join(" | ") : null;

  const allowedStatuses = new Set([
    "pending", "confirmed", "in_progress", "completed", "cancelled", "needs_review",
  ]);
  const allowedPaymentStatuses = new Set(["pending", "paid", "failed", "refunded", "cancelled"]);

  let booking_status: "pending" | "confirmed" | "needs_review" | "in_progress" | "completed" | "cancelled";
  if (input.source === "admin" && input.requested_booking_status && allowedStatuses.has(input.requested_booking_status)) {
    booking_status = input.requested_booking_status as typeof booking_status;
  } else if (input.source === "botmaker") {
    booking_status = "confirmed";
  } else {
    booking_status = inside_coverage ? "pending" : "needs_review";
  }
  if (vehicle_type === "Otro" && input.source !== "admin") booking_status = "needs_review";
  if (input.source === "botmaker" && !inside_coverage) booking_status = "needs_review";

  let payment_status = "pending";
  if (input.requested_payment_status && allowedPaymentStatuses.has(input.requested_payment_status)) {
    payment_status = input.requested_payment_status;
  }

  const location_validation_status = inside_coverage
    ? `validated_${cov.match_type}`
    : "outside_coverage_or_unverified";

  const { data: created, error: insErr } = await admin.from("bookings").insert({
    customer_id,
    customer_name, customer_phone, customer_email,
    address, neighborhood, vehicle_type,
    service_id: service.id, service_name: service.name,
    scheduled_date, scheduled_time,
    duration_minutes: service.duration_minutes,
    price: total_price,
    payment_method,
    payment_status,
    booking_status,
    booking_source: input.source,
    notes,
    place_id: input.place_id ?? null,
    formatted_address: input.formatted_address ?? null,
    address_lat: typeof input.address_lat === "number" ? input.address_lat : null,
    address_lng: typeof input.address_lng === "number" ? input.address_lng : null,
    coverage_zone_id: cov.zone?.id ?? null,
    coverage_zone_name: cov.zone?.name ?? null,
    location_validation_status,
    location_validation_payload: { match_type: cov.match_type, distance_km: cov.distance_km, neighborhood },
    vehicle_surcharge: surcharge,
    selected_extras,
    extras_total,
    price_breakdown,
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
    coverage_zone_id: cov.zone?.id ?? null,
    coverage_zone_name: cov.zone?.name ?? null,
  };
}
