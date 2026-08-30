// @ts-nocheck -- ported verbatim from functions/; not our source of truth for types
// Shared slot capacity counting (same rules as get-public-availability / booking-core).

export function timeToMinutes(t: string): number {
  const [h, m] = String(t).slice(0, 5).split(":").map(Number);
  return h * 60 + m;
}

export type SlotRow = {
  id: string;
  date: string;
  start_time: string;
  end_time: string;
  capacity: number;
};

export type BookingOverlapRow = {
  scheduled_date: string;
  scheduled_time: string;
  duration_minutes: number;
};

export function countOverlappingBookings(
  slot: Pick<SlotRow, "date" | "start_time" | "end_time">,
  bookingsOnDate: BookingOverlapRow[],
): number {
  const sStart = timeToMinutes(slot.start_time);
  const sEnd = timeToMinutes(slot.end_time);
  let taken = 0;
  for (const b of bookingsOnDate) {
    const bStart = timeToMinutes(b.scheduled_time);
    const bEnd = bStart + (b.duration_minutes ?? 0);
    if (bStart < sEnd && bEnd > sStart) taken++;
  }
  return taken;
}

/** Overlap count for a booking that would start at `requestedStartTime` and run `requestedDurationMinutes`. */
export function countOverlappingBookingsForRequestedInterval(
  requestedStartTime: string,
  requestedDurationMinutes: number,
  bookingsOnDate: BookingOverlapRow[],
): number {
  const reqStart = timeToMinutes(requestedStartTime);
  const reqEnd = reqStart + requestedDurationMinutes;
  let taken = 0;
  for (const b of bookingsOnDate) {
    const bStart = timeToMinutes(b.scheduled_time);
    const bEnd = bStart + (b.duration_minutes ?? 0);
    if (bStart < reqEnd && bEnd > reqStart) taken++;
  }
  return taken;
}

export function remainingCapacity(slot: SlotRow, bookingsOnDate: BookingOverlapRow[]): number {
  const taken = countOverlappingBookings(slot, bookingsOnDate);
  return Math.max(0, (slot.capacity ?? 0) - taken);
}

export function remainingCapacityForRequestedInterval(
  slot: Pick<SlotRow, "start_time" | "capacity">,
  requestedDurationMinutes: number,
  bookingsOnDate: BookingOverlapRow[],
): number {
  const taken = countOverlappingBookingsForRequestedInterval(
    slot.start_time,
    requestedDurationMinutes,
    bookingsOnDate,
  );
  return Math.max(0, (slot.capacity ?? 0) - taken);
}

export function maxOperatingDayEndMinutes(slots: Array<{ end_time: string }>): number {
  let max = 0;
  for (const s of slots) {
    const end = timeToMinutes(s.end_time);
    if (end > max) max = end;
  }
  return max;
}

/** True when requestedStart + duration does not exceed the day's operating end (latest slot end_time). */
export function requestedIntervalFitsOperatingEnd(
  operatingDayEndMinutes: number,
  requestedStartTime: string,
  requestedDurationMinutes: number,
): boolean {
  if (operatingDayEndMinutes <= 0) return false;
  const reqStart = timeToMinutes(requestedStartTime);
  const reqEnd = reqStart + requestedDurationMinutes;
  return reqEnd <= operatingDayEndMinutes;
}

/** @deprecated Availability uses requestedIntervalFitsOperatingEnd; kept for legacy slot-window checks. */
export function serviceFitsSlot(
  slot: Pick<SlotRow, "start_time" | "end_time">,
  durationMinutes: number,
): boolean {
  const reqStart = timeToMinutes(slot.start_time);
  const reqEnd = reqStart + durationMinutes;
  const slotEnd = timeToMinutes(slot.end_time);
  return reqEnd <= slotEnd;
}
