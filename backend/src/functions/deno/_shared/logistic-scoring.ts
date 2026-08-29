// @ts-nocheck -- ported verbatim from supabase/functions; not our source of truth for types
// Logistic slot scoring (haversine, zone clustering). MVP heuristics only.

import { timeToMinutes, type BookingOverlapRow, type SlotRow } from "./slot-capacity.ts";

export type ScoredLogisticSlot = {
  slot_id: string;
  date: string;
  start_time: string;
  end_time: string;
  remaining_capacity: number;
  score: number;
  reason: string;
  nearby_bookings_count: number;
  same_zone_bookings_count: number;
  considered_bookings_count: number;
  zone_match: boolean;
};

export type BookingForLogistics = BookingOverlapRow & {
  id?: string;
  booking_status?: string | null;
  coverage_zone_id?: string | null;
  coverage_zone_name?: string | null;
  address_lat?: number | null;
  address_lng?: number | null;
};

const EARTH_KM = 6371;

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.sqrt(a));
}

function normZone(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase();
}

function isAdjacentTime(
  slotStartMin: number,
  slotEndMin: number,
  bookingStartMin: number,
  bookingDuration: number,
): boolean {
  const bookingEnd = bookingStartMin + bookingDuration;
  const gapBefore = Math.abs(slotStartMin - bookingEnd);
  const gapAfter = Math.abs(slotEndMin - bookingStartMin);
  if (gapBefore <= 120) return true;
  if (gapAfter <= 120) return true;
  return false;
}

export function scoreLogisticSlot(
  slot: SlotRow & { remaining_capacity: number },
  ctx: {
    address_lat: number;
    address_lng: number;
    coverage_zone_id: string | null;
    coverage_zone_name: string | null;
    bookingsOnDate: BookingForLogistics[];
  },
): ScoredLogisticSlot {
  const zoneId = ctx.coverage_zone_id;
  const zoneName = normZone(ctx.coverage_zone_name);
  const slotStart = timeToMinutes(slot.start_time);
  const slotEnd = timeToMinutes(slot.end_time);

  let score = 35;
  let reason = "Disponible";
  let nearbyBookingsCount = 0;
  let sameZoneBookingsCount = 0;
  let consideredBookingsCount = 0;
  let zoneMatch = false;
  let hasNearbyOrSameZoneSignal = false;
  let hasAdjacencySignal = false;
  let farJumpPenalty = 0;

  const activeBookings = ctx.bookingsOnDate.filter((b) => b.scheduled_date === slot.date);

  if (activeBookings.length === 0) {
    return {
      slot_id: slot.id,
      date: slot.date,
      start_time: String(slot.start_time).slice(0, 5),
      end_time: String(slot.end_time).slice(0, 5),
      remaining_capacity: slot.remaining_capacity,
      score: 50,
      reason: "Disponible",
      nearby_bookings_count: 0,
      same_zone_bookings_count: 0,
      considered_bookings_count: 0,
      zone_match: false,
    };
  }

  for (const b of activeBookings) {
    consideredBookingsCount++;
    const bZoneName = normZone(b.coverage_zone_name);
    const sameZone =
      (zoneId && b.coverage_zone_id && b.coverage_zone_id === zoneId) ||
      (zoneName && bZoneName && zoneName === bZoneName);

    if (sameZone) {
      zoneMatch = true;
      hasNearbyOrSameZoneSignal = true;
      sameZoneBookingsCount++;
      score += 30;
    }

    const blat = b.address_lat;
    const blng = b.address_lng;
    let nearThisBooking = false;
    if (typeof blat === "number" && typeof blng === "number") {
      const dist = haversineKm(ctx.address_lat, ctx.address_lng, blat, blng);
      if (dist <= 2) {
        score += 50;
        nearbyBookingsCount++;
        nearThisBooking = true;
      } else if (dist <= 5) {
        score += 35;
        nearThisBooking = true;
      } else if (dist <= 10) {
        score += 10;
        nearThisBooking = true;
      } else {
        farJumpPenalty += 8;
      }
      if (nearThisBooking) hasNearbyOrSameZoneSignal = true;
    }

    const bStart = timeToMinutes(b.scheduled_time);
    const adjacent = isAdjacentTime(slotStart, slotEnd, bStart, b.duration_minutes ?? 60);
    if (adjacent && (sameZone || nearThisBooking)) {
      hasAdjacencySignal = true;
      score += 30;
    }
  }

  score -= farJumpPenalty;

  // Same-day nearby/same-zone signal should still push recommendations.
  if (hasNearbyOrSameZoneSignal && score < 72) {
    score = 72;
  }

  if (nearbyBookingsCount > 0) {
    reason = "Ya tenemos un lavado cerca";
  } else if (sameZoneBookingsCount > 0) {
    reason = "Misma zona";
  } else if (hasAdjacencySignal) {
    reason = "Ayuda a ordenar la ruta";
  } else {
    reason = "Disponible";
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  return {
    slot_id: slot.id,
    date: slot.date,
    start_time: String(slot.start_time).slice(0, 5),
    end_time: String(slot.end_time).slice(0, 5),
    remaining_capacity: slot.remaining_capacity,
    score,
    reason,
    nearby_bookings_count: nearbyBookingsCount,
    same_zone_bookings_count: sameZoneBookingsCount,
    considered_bookings_count: consideredBookingsCount,
    zone_match: zoneMatch,
  };
}

/** Recommended if score >= threshold or among top scores for the day */
export function splitRecommendedSlots(
  scored: ScoredLogisticSlot[],
  opts?: { minScore?: number; maxRecommendedPerDay?: number },
): { recommended: ScoredLogisticSlot[]; other: ScoredLogisticSlot[] } {
  const minScore = opts?.minScore ?? 72;
  const maxPerDay = opts?.maxRecommendedPerDay ?? 3;
  const sorted = [...scored].sort((a, b) => b.score - a.score || a.start_time.localeCompare(b.start_time));
  const recommendedIds = new Set<string>();

  for (const s of sorted) {
    if (
      s.score >= minScore ||
      s.nearby_bookings_count > 0 ||
      s.same_zone_bookings_count > 0
    ) {
      recommendedIds.add(s.slot_id);
    }
  }

  const byDate = new Map<string, ScoredLogisticSlot[]>();
  for (const s of sorted) {
    const list = byDate.get(s.date) ?? [];
    list.push(s);
    byDate.set(s.date, list);
  }
  for (const list of byDate.values()) {
    let n = 0;
    for (const s of list) {
      if (n >= maxPerDay) break;
      if (s.score >= 60) {
        recommendedIds.add(s.slot_id);
        n++;
      }
    }
  }

  const recommended = sorted.filter((s) => recommendedIds.has(s.slot_id));
  const other = sorted.filter((s) => !recommendedIds.has(s.slot_id));
  return { recommended, other };
}
