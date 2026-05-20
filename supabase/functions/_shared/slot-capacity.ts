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

export function remainingCapacity(slot: SlotRow, bookingsOnDate: BookingOverlapRow[]): number {
  const taken = countOverlappingBookings(slot, bookingsOnDate);
  return Math.max(0, (slot.capacity ?? 0) - taken);
}

export function serviceFitsSlot(
  slot: Pick<SlotRow, "start_time" | "end_time">,
  durationMinutes: number,
): boolean {
  const reqStart = timeToMinutes(slot.start_time);
  const reqEnd = reqStart + durationMinutes;
  const slotEnd = timeToMinutes(slot.end_time);
  return reqEnd <= slotEnd;
}
