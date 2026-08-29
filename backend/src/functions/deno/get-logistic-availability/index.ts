// @ts-nocheck -- ported verbatim from supabase/functions; not our source of truth for types
// Logistic availability: capacity + zone/distance scoring for address-first booking.
import { createClient } from "@supabase/supabase-js";
import { queryLogisticAvailabilityDays } from "../_shared/logistic-availability.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type BookingUnitPayload = {
  vehicle_type?: string;
  service_id?: string | null;
  service_name?: string | null;
  selected_extras?: string[];
};

type Payload = {
  address_lat?: number;
  address_lng?: number;
  coverage_zone_id?: string | null;
  coverage_zone_name?: string | null;
  service_id?: string | null;
  date_from?: string;
  date_to?: string;
  duration_minutes?: number;
  booking_units?: BookingUnitPayload[];
  vehicle_type?: string;
  selected_extras?: string[];
  debug?: boolean;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const SUPABASE_URL = process.env.SUPABASE_URL!;
  const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  let body: Payload;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  const lat = body.address_lat;
  const lng = body.address_lng;
  if (typeof lat !== "number" || typeof lng !== "number") {
    return json({ ok: false, error: "missing_coordinates" }, 400);
  }

  const serviceId = (body.service_id ?? "").trim();
  if (!serviceId) return json({ ok: false, error: "missing_service_id" }, 400);

  const debugMode = body.debug === true;
  const booking_units = Array.isArray(body.booking_units)
    ? body.booking_units.map((unit) => ({
      vehicle_type: String(unit.vehicle_type ?? "").trim(),
      service_id: unit.service_id ?? null,
      service_name: unit.service_name ?? null,
      selected_extras: Array.isArray(unit.selected_extras) ? unit.selected_extras : [],
    }))
    : undefined;

  const result = await queryLogisticAvailabilityDays(admin, {
    address_lat: lat,
    address_lng: lng,
    coverage_zone_id: body.coverage_zone_id ?? null,
    coverage_zone_name: body.coverage_zone_name ?? null,
    service_id: serviceId,
    duration_minutes: body.duration_minutes,
    booking_units,
    vehicle_type: body.vehicle_type,
    selected_extras: Array.isArray(body.selected_extras) ? body.selected_extras : undefined,
    date_from: body.date_from,
    date_to: body.date_to,
  });

  if (!result.ok) {
    const status = result.error === "server_error" ? 500 : 400;
    return json({ ok: false, error: result.error }, status);
  }

  const { days, date_from, date_to, duration_minutes } = result;

  if (debugMode) {
    const first = days[0];
    console.log("[get-logistic-availability][debug]", {
      address_lat: lat,
      address_lng: lng,
      coverage_zone_id: body.coverage_zone_id ?? null,
      coverage_zone_name: body.coverage_zone_name ?? null,
      duration_minutes,
      days_returned: days.length,
      first_day: first?.date ?? null,
      first_recommended: first?.recommended_slots.length ?? 0,
      first_other: first?.other_slots.length ?? 0,
    });
  }

  return json({
    ok: true,
    date_from,
    date_to,
    duration_minutes,
    days,
    ...(debugMode
      ? {
          debug: {
            address_lat: lat,
            address_lng: lng,
            coverage_zone_id: body.coverage_zone_id ?? null,
            coverage_zone_name: body.coverage_zone_name ?? null,
            considered_bookings_total: null,
          },
        }
      : {}),
  });
});
