import type { PeriodPreset, PeriodRange } from "./types";

/** Local calendar date as YYYY-MM-DD (avoids UTC shift from toISOString). */
function toIsoDate(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Parse YYYY-MM-DD into local Date parts without timezone conversion. */
function parseIsoDate(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.split("-").map(Number);
  return { y, m: m - 1, d };
}

export function todayIso(): string {
  const now = new Date();
  return toIsoDate(now.getFullYear(), now.getMonth(), now.getDate());
}

export function addDaysIso(base: string, days: number): string {
  const { y, m, d } = parseIsoDate(base);
  const dt = new Date(y, m, d + days);
  return toIsoDate(dt.getFullYear(), dt.getMonth(), dt.getDate());
}

export function monthBounds(ref = new Date()): PeriodRange {
  const y = ref.getFullYear();
  const m = ref.getMonth();
  const lastDay = new Date(y, m + 1, 0).getDate();
  return {
    from: toIsoDate(y, m, 1),
    to: toIsoDate(y, m, lastDay),
  };
}

export function getPeriodRange(
  preset: PeriodPreset,
  customFrom?: string,
  customTo?: string,
): PeriodRange {
  const today = todayIso();
  switch (preset) {
    case "today":
      return { from: today, to: today };
    case "next7":
      return { from: today, to: addDaysIso(today, 6) };
    case "last7":
      return { from: addDaysIso(today, -6), to: today };
    case "month":
      return monthBounds();
    case "last30":
      return { from: addDaysIso(today, -29), to: today };
    case "custom": {
      const from = customFrom || today;
      const to = customTo || today;
      return from <= to ? { from, to } : { from: to, to: from };
    }
  }
}

export const PERIOD_LABELS: Record<PeriodPreset, string> = {
  today: "Hoy",
  next7: "Próximos 7 días",
  last7: "Últimos 7 días",
  month: "Mes actual",
  last30: "Últimos 30 días",
  custom: "Personalizado",
};

function safeNumber(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return n;
}

export function fmtCurrency(n: number) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(safeNumber(n));
}

export function fmtPct(n: number) {
  return `${safeNumber(n).toFixed(1)}%`;
}

export function fmtDate(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

export function isCancelled(status: string) {
  return status === "cancelled";
}

export function isActiveBooking(status: string) {
  return !isCancelled(status);
}

export function safePrice(price: number | null | undefined): number | null {
  if (price == null || Number.isNaN(price)) return null;
  return price;
}

export function safeVehicleCount(count: number | null | undefined): number | null {
  if (count == null || Number.isNaN(count) || count <= 0) return null;
  return count;
}

export function normalizePaymentMethod(method: string): "mp" | "transfer" | "later" | "other" {
  const m = method.trim().toLowerCase();
  if (m.includes("mercado")) return "mp";
  if (m.includes("transfer")) return "transfer";
  if (m.includes("despu") || m.includes("despues")) return "later";
  return "other";
}

export function zoneLabel(neighborhood: string, privateName: string | null) {
  if (privateName?.trim()) return privateName.trim();
  return neighborhood?.trim() || "—";
}

export function downloadBlob(content: string, filename: string, mime: string) {
  const blob = new Blob(["\uFEFF", content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Escape CSV cells and neutralize formula injection (=, +, -, @). */
export function csvEscape(value: string | number | null | undefined): string {
  let s = value == null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Escape HTML for safe .xls export. */
export function htmlEscape(value: string | number | null | undefined): string {
  const s = value == null ? "" : String(value);
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** V1 dataset cap — queries truncate beyond this; no server-side pagination yet. */
export const FINANCE_QUERY_LIMIT = 5000;
