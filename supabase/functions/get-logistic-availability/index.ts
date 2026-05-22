// Logistic availability: capacity + zone/distance scoring for address-first booking.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  remainingCapacity,
  serviceFitsSlot,
  type BookingOverlapRow,
  type SlotRow,
} from "../_shared/slot-capacity.ts";
import {
  scoreLogisticSlot,
  splitRecommendedSlots,
  type BookingForLogistics,
  type ScoredLogisticSlot,
} from "../_shared/logistic-scoring.ts";

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

function isDate(v: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(v);
}

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

const PUBLIC_MIN_LEAD_MINUTES = 120;

function slotStartUtcMsFromBuenosAires(dateIso: string, timeHHMM: string) {
  const [y, m, d] = dateIso.split("-").map(Number);
  const [hh, mm] = String(timeHHMM).slice(0, 5).split(":").map(Number);
  if (
    !Number.isFinite(y) ||
    !Number.isFinite(m) ||
    !Number.isFinite(d) ||
    !Number.isFinite(hh) ||
    !Number.isFinite(mm)
  ) {
    return null;
  }
  return Date.UTC(y, m - 1, d, hh + 3, mm, 0, 0);
}

function isSlotTooSoonForPublic(dateIso: string, timeHHMM: string, nowMs = Date.now()) {
  const slotMs = slotStartUtcMsFromBuenosAires(dateIso, timeHHMM);
  if (slotMs == null) return true;
  return slotMs < nowMs + PUBLIC_MIN_LEAD_MINUTES * 60_000;
}

type Payload = {
  address_lat?: number;
  address_lng?: number;
  coverage_zone_id?: string | null;
  coverage_zone_name?: string | null;
  service_id?: string | null;
  date_from?: string;
  date_to?: string;
  duration_minutes?: number;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
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

  const today = new Date().toISOString().slice(0, 10);
  let dateFrom = (body.date_from ?? today).trim();
  let dateTo = (body.date_to ?? addDays(today, 13)).trim();
  if (!isDate(dateFrom)) dateFrom = today;
  if (!isDate(dateTo)) dateTo = addDays(today, 13);
  if (dateFrom < today) dateFrom = today;
  if (dateTo < dateFrom) dateTo = addDays(dateFrom, 13);

  const serviceId = (body.service_id ?? "").trim();
  let durationMinutes: number | null =
    typeof body.duration_minutes === "number" && body.duration_minutes > 0
      ? Math.round(body.duration_minutes)
      : null;

  if (serviceId) {
    const { data: svc, error: svcErr } = await admin
      .from("services")
      .select("duration_minutes, active")
      .eq("id", serviceId)
      .maybeSingle();
    if (svcErr || !svc?.active || typeof svc.duration_minutes !== "number" || svc.duration_minutes <= 0) {
      return json({ ok: false, error: "invalid_service" }, 400);
    }
    durationMinutes = svc.duration_minutes;
  }

  if (durationMinutes == null || durationMinutes <= 0) {
    return json({ ok: false, error: "missing_duration" }, 400);
  }

  const { data: slots, error: slotErr } = await admin
    .from("availability_slots")
    .select("id,date,start_time,end_time,capacity")
    .eq("active", true)
    .gte("date", dateFrom)
    .lte("date", dateTo)
    .order("date")
    .order("start_time")
    .limit(2000);

  if (slotErr) {
    console.error("[get-logistic-availability] slots", slotErr);
    return json({ ok: false, error: "server_error" }, 500);
  }

  const { data: bookings, error: bkErr } = await admin
    .from("bookings")
    .select(
      "id,scheduled_date,scheduled_time,duration_minutes,booking_status,coverage_zone_id,coverage_zone_name,address_lat,address_lng",
    )
    .gte("scheduled_date", dateFrom)
    .lte("scheduled_date", dateTo)
    .neq("booking_status", "cancelled")
    .limit(5000);

  if (bkErr) {
    console.error("[get-logistic-availability] bookings", bkErr);
    return json({ ok: false, error: "server_error" }, 500);
  }

  const bookingsList = (bookings ?? []) as BookingForLogistics[];
  const bookingsByDate = new Map<string, BookingOverlapRow[]>();
  const logisticsByDate = new Map<string, BookingForLogistics[]>();

  for (const b of bookingsList) {
    const d = b.scheduled_date as string;
    const row: BookingOverlapRow = {
      scheduled_date: d,
      scheduled_time: b.scheduled_time as string,
      duration_minutes: (b.duration_minutes as number) ?? 60,
    };
    const arr = bookingsByDate.get(d) ?? [];
    arr.push(row);
    bookingsByDate.set(d, arr);

    const logArr = logisticsByDate.get(d) ?? [];
    logArr.push(b);
    logisticsByDate.set(d, logArr);
  }

  const daysMap = new Map<string, ScoredLogisticSlot[]>();
  const nowMs = Date.now();

  for (const raw of slots ?? []) {
    const slot: SlotRow = {
      id: raw.id as string,
      date: raw.date as string,
      start_time: String(raw.start_time),
      end_time: String(raw.end_time),
      capacity: (raw.capacity as number) ?? 1,
    };

    if (isSlotTooSoonForPublic(slot.date, slot.start_time, nowMs)) continue;
    if (!serviceFitsSlot(slot, durationMinutes)) continue;

    const onDate = bookingsByDate.get(slot.date) ?? [];
    const remaining = remainingCapacity(slot, onDate);
    if (remaining <= 0) continue;

    const scored = scoreLogisticSlot(
      { ...slot, remaining_capacity: remaining },
      {
        address_lat: lat,
        address_lng: lng,
        coverage_zone_id: body.coverage_zone_id ?? null,
        coverage_zone_name: body.coverage_zone_name ?? null,
        bookingsOnDate: logisticsByDate.get(slot.date) ?? [],
      },
    );

    const list = daysMap.get(slot.date) ?? [];
    list.push(scored);
    daysMap.set(slot.date, list);
  }

  const days: Array<{
    date: string;
    recommended_slots: ScoredLogisticSlot[];
    other_slots: ScoredLogisticSlot[];
  }> = [];

  for (let d = dateFrom; d <= dateTo; d = addDays(d, 1)) {
    const scored = daysMap.get(d) ?? [];
    if (scored.length === 0) continue;
    const { recommended, other } = splitRecommendedSlots(scored);
    days.push({
      date: d,
      recommended_slots: recommended,
      other_slots: other,
    });
  }

  return json({
    ok: true,
    date_from: dateFrom,
    date_to: dateTo,
    duration_minutes: durationMinutes,
    days,
  });
});
