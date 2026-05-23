import { BOOKING_STATUSES, PAYMENT_STATUSES } from "@/lib/booking-badges";

export const NO_ZONE_ID = "__no_zone__";

export type DatePreset = "today" | "week" | "month" | "last30" | "custom";

export type DemandBooking = {
  id: string;
  customer_name: string;
  customer_phone: string;
  service_name: string;
  vehicle_type: string;
  scheduled_date: string;
  scheduled_time: string;
  booking_status: string;
  payment_status: string;
  booking_source: string;
  marketing_campaign: string | null;
  qr_code_slug: string | null;
  price: number;
  coverage_zone_id: string | null;
  coverage_zone_name: string | null;
  address_lat: number | null;
  address_lng: number | null;
  formatted_address: string | null;
  address: string;
  neighborhood: string;
  created_at: string;
};

export type AttributionPerformanceRow = {
  campaign: string;
  qr: string;
  bookings: number;
  paid: number;
  completed: number;
  revenue: number;
};

export type CoverageZoneRow = {
  id: string;
  name: string;
  active: boolean;
  center_lat: number | null;
  center_lng: number | null;
  radius_km: number;
  polygon_geojson: unknown;
  display_order: number;
};

export type DemandFilters = {
  preset: DatePreset;
  dateFrom: string;
  dateTo: string;
  bookingStatus: string;
  paymentStatus: string;
  serviceName: string;
  bookingSource: string;
  coverageZoneId: string;
  onlyWithoutCoords: boolean;
};

export type ZonePerformanceRow = {
  zoneId: string;
  zoneName: string;
  total: number;
  completed: number;
  confirmedUpcoming: number;
  pendingReview: number;
  cancelled: number;
  paidRevenue: number;
  potentialRevenue: number;
  averageTicket: number;
  latestBookingDate: string | null;
  withCoords: number;
  withoutCoords: number;
};

export type DemandMetrics = {
  total: number;
  completed: number;
  confirmedUpcoming: number;
  pendingReview: number;
  cancelled: number;
  potentialRevenue: number;
  paidRevenue: number;
  averageTicket: number;
  topZoneByCount: string | null;
  topZoneByRevenue: string | null;
};

export const DATE_PRESET_LABELS: Record<DatePreset, string> = {
  today: "Hoy",
  week: "Esta semana",
  month: "Este mes",
  last30: "Últimos 30 días",
  custom: "Personalizado",
};

const isoOf = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const addDays = (d: Date, n: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};

const startOfWeek = (d: Date) => {
  const x = new Date(d);
  const dow = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - dow);
  x.setHours(0, 0, 0, 0);
  return x;
};

const endOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0);

export function getDateRangeForPreset(preset: DatePreset, customFrom?: string, customTo?: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  switch (preset) {
    case "today":
      return { from: isoOf(today), to: isoOf(today) };
    case "week": {
      const start = startOfWeek(today);
      return { from: isoOf(start), to: isoOf(addDays(start, 6)) };
    }
    case "month":
      return {
        from: isoOf(new Date(today.getFullYear(), today.getMonth(), 1)),
        to: isoOf(endOfMonth(today)),
      };
    case "last30":
      return { from: isoOf(addDays(today, -29)), to: isoOf(today) };
    case "custom":
    default:
      return {
        from: customFrom || isoOf(today),
        to: customTo || isoOf(today),
      };
  }
}

export function zoneKeyForBooking(b: DemandBooking) {
  return b.coverage_zone_id || NO_ZONE_ID;
}

export function zoneLabelForBooking(b: DemandBooking) {
  if (b.coverage_zone_id && b.coverage_zone_name) return b.coverage_zone_name;
  if (b.coverage_zone_name) return b.coverage_zone_name;
  return "Sin zona / No validada";
}

export function hasCoordinates(b: DemandBooking) {
  return typeof b.address_lat === "number" && typeof b.address_lng === "number";
}

export function isCancelled(status: string) {
  return status === "cancelled";
}

export function isPendingReview(status: string) {
  return status === "pending" || status === "needs_review";
}

export function isConfirmedUpcoming(status: string) {
  return status === "confirmed" || status === "in_progress";
}

export function filterBookings(bookings: DemandBooking[], filters: DemandFilters) {
  return bookings.filter((b) => {
    if (filters.bookingStatus !== "all" && b.booking_status !== filters.bookingStatus) return false;
    if (filters.paymentStatus !== "all" && b.payment_status !== filters.paymentStatus) return false;
    if (filters.serviceName !== "all" && b.service_name !== filters.serviceName) return false;
    if (filters.bookingSource !== "all" && b.booking_source !== filters.bookingSource) return false;
    if (filters.coverageZoneId !== "all" && zoneKeyForBooking(b) !== filters.coverageZoneId)
      return false;
    if (filters.onlyWithoutCoords && hasCoordinates(b)) return false;
    return true;
  });
}

export function computeMetrics(bookings: DemandBooking[]): DemandMetrics {
  const nonCancelled = bookings.filter((b) => !isCancelled(b.booking_status));
  const potentialRevenue = nonCancelled.reduce((sum, b) => sum + (b.price ?? 0), 0);
  const paidRevenue = bookings
    .filter((b) => b.payment_status === "paid")
    .reduce((sum, b) => sum + (b.price ?? 0), 0);

  const countByZone = new Map<string, number>();
  const revenueByZone = new Map<string, number>();

  for (const b of bookings) {
    const key = zoneLabelForBooking(b);
    countByZone.set(key, (countByZone.get(key) ?? 0) + 1);
    if (!isCancelled(b.booking_status)) {
      revenueByZone.set(key, (revenueByZone.get(key) ?? 0) + (b.price ?? 0));
    }
  }

  let topZoneByCount: string | null = null;
  let topCount = 0;
  for (const [name, count] of countByZone) {
    if (count > topCount) {
      topCount = count;
      topZoneByCount = name;
    }
  }

  let topZoneByRevenue: string | null = null;
  let topRevenue = 0;
  for (const [name, rev] of revenueByZone) {
    if (rev > topRevenue) {
      topRevenue = rev;
      topZoneByRevenue = name;
    }
  }

  return {
    total: bookings.length,
    completed: bookings.filter((b) => b.booking_status === "completed").length,
    confirmedUpcoming: bookings.filter((b) => isConfirmedUpcoming(b.booking_status)).length,
    pendingReview: bookings.filter((b) => isPendingReview(b.booking_status)).length,
    cancelled: bookings.filter((b) => isCancelled(b.booking_status)).length,
    potentialRevenue,
    paidRevenue,
    averageTicket: nonCancelled.length ? potentialRevenue / nonCancelled.length : 0,
    topZoneByCount,
    topZoneByRevenue,
  };
}

export function computeZonePerformance(
  bookings: DemandBooking[],
  zones: CoverageZoneRow[],
): ZonePerformanceRow[] {
  const rows = new Map<string, ZonePerformanceRow>();

  const ensure = (zoneId: string, zoneName: string) => {
    if (!rows.has(zoneId)) {
      rows.set(zoneId, {
        zoneId,
        zoneName,
        total: 0,
        completed: 0,
        confirmedUpcoming: 0,
        pendingReview: 0,
        cancelled: 0,
        paidRevenue: 0,
        potentialRevenue: 0,
        averageTicket: 0,
        latestBookingDate: null,
        withCoords: 0,
        withoutCoords: 0,
      });
    }
    return rows.get(zoneId)!;
  };

  for (const z of zones) ensure(z.id, z.name);
  ensure(NO_ZONE_ID, "Sin zona / No validada");

  for (const b of bookings) {
    const zoneId = zoneKeyForBooking(b);
    const zoneName = zoneLabelForBooking(b);
    const row = ensure(zoneId, zoneName);
    row.total++;
    if (b.booking_status === "completed") row.completed++;
    if (isConfirmedUpcoming(b.booking_status)) row.confirmedUpcoming++;
    if (isPendingReview(b.booking_status)) row.pendingReview++;
    if (isCancelled(b.booking_status)) row.cancelled++;
    if (b.payment_status === "paid") row.paidRevenue += b.price ?? 0;
    if (!isCancelled(b.booking_status)) row.potentialRevenue += b.price ?? 0;
    if (hasCoordinates(b)) row.withCoords++;
    else row.withoutCoords++;
    if (!row.latestBookingDate || b.scheduled_date > row.latestBookingDate) {
      row.latestBookingDate = b.scheduled_date;
    }
  }

  for (const row of rows.values()) {
    const activeCount = row.total - row.cancelled;
    row.averageTicket = activeCount > 0 ? row.potentialRevenue / activeCount : 0;
  }

  return Array.from(rows.values()).sort((a, b) => {
    if (a.zoneId === NO_ZONE_ID) return 1;
    if (b.zoneId === NO_ZONE_ID) return -1;
    return b.total - a.total || a.zoneName.localeCompare(b.zoneName, "es");
  });
}

export function computeAttributionPerformance(bookings: DemandBooking[]): AttributionPerformanceRow[] {
  const rows = new Map<string, AttributionPerformanceRow>();

  for (const b of bookings) {
    const campaign = (b.marketing_campaign ?? "sin_campana").trim() || "sin_campana";
    const qr = (b.qr_code_slug ?? "sin_qr").trim() || "sin_qr";
    const key = `${campaign}::${qr}`;
    const row = rows.get(key) ?? {
      campaign,
      qr,
      bookings: 0,
      paid: 0,
      completed: 0,
      revenue: 0,
    };
    row.bookings += 1;
    if (b.payment_status === "paid") {
      row.paid += 1;
      row.revenue += Number(b.price ?? 0);
    }
    if (b.booking_status === "completed") {
      row.completed += 1;
    }
    rows.set(key, row);
  }

  return Array.from(rows.values()).sort((a, b) => b.bookings - a.bookings || b.revenue - a.revenue);
}

export function geoJsonToPaths(geo: unknown): { lat: number; lng: number }[][] {
  if (!geo || typeof geo !== "object") return [];
  const g = geo as { type?: string; coordinates?: unknown };
  const polys: number[][][][] =
    g.type === "Polygon"
      ? [g.coordinates as number[][][]]
      : g.type === "MultiPolygon"
        ? (g.coordinates as number[][][][])
        : [];

  const paths: { lat: number; lng: number }[][] = [];
  for (const poly of polys) {
    const ring = poly?.[0];
    if (!Array.isArray(ring)) continue;
    paths.push(
      ring.map(([lng, lat]) => ({
        lat: Number(lat),
        lng: Number(lng),
      })),
    );
  }
  return paths;
}

export function formatDemandDate(iso: string) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function formatDemandDateTime(date: string, time: string) {
  const dateLabel = formatDemandDate(date);
  if (!time) return dateLabel;
  const short = time.slice(0, 5);
  return `${dateLabel} ${short}`;
}

export function formatARS(value: number) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(Number(value) || 0);
}

export const BOOKING_STATUS_FILTER_OPTIONS = ["all", ...BOOKING_STATUSES] as const;
export const PAYMENT_STATUS_FILTER_OPTIONS = ["all", ...PAYMENT_STATUSES] as const;
