import { bookingSourceLabels, bookingStatusLabels } from "@/lib/booking-badges";
import type {
  BreakdownItem,
  DailyCashRow,
  FinanceAlert,
  FinanceBooking,
  FinanceComputed,
  FinanceKPIs,
  FinancePayment,
  FinanceReceipt,
  PaymentMethodBreakdown,
  PlanillaAssumptions,
  PlanillaResult,
} from "./types";
import {
  isActiveBooking,
  isCancelled,
  normalizePaymentMethod,
  safePrice,
  safeVehicleCount,
  todayIso,
  zoneLabel,
  FINANCE_QUERY_LIMIT,
} from "./utils";

function emptyPaymentBreakdown(): PaymentMethodBreakdown {
  return { mercadoPago: 0, transferencia: 0, pagarDespues: 0, other: 0 };
}

function addToPaymentBreakdown(breakdown: PaymentMethodBreakdown, method: string, amount: number) {
  const key = normalizePaymentMethod(method);
  if (key === "mp") breakdown.mercadoPago += amount;
  else if (key === "transfer") breakdown.transferencia += amount;
  else if (key === "later") breakdown.pagarDespues += amount;
  else breakdown.other += amount;
}

export function buildApprovedMap(payments: FinancePayment[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const p of payments) {
    if (p.status !== "approved" || !p.booking_id) continue;
    map.set(p.booking_id, (map.get(p.booking_id) ?? 0) + p.amount);
  }
  return map;
}

/**
 * Cobrado por reserva — una sola fuente, sin doble conteo:
 * - payment_status = paid  → booking.price
 * - si no, fallback        → suma de pagos approved (parcial permitido, tope en price)
 */
export function getBookingCollectedAmount(
  booking: FinanceBooking,
  approvedByBooking: Map<string, number>,
): number {
  const price = safePrice(booking.price);
  if (price == null || price <= 0) return 0;

  if (booking.payment_status === "paid") {
    return price;
  }

  const approvedSum = approvedByBooking.get(booking.id) ?? 0;
  if (approvedSum <= 0) return 0;

  return Math.min(approvedSum, price);
}

function buildReceiptMap(receipts: FinanceReceipt[]) {
  const byBooking = new Map<string, FinanceReceipt[]>();
  for (const r of receipts) {
    if (!r.booking_id) continue;
    const list = byBooking.get(r.booking_id) ?? [];
    list.push(r);
    byBooking.set(r.booking_id, list);
  }
  return byBooking;
}

function aggregateBreakdown(
  bookings: FinanceBooking[],
  keyFn: (b: FinanceBooking) => string,
  labelFn?: (key: string) => string,
): BreakdownItem[] {
  const map = new Map<string, { revenue: number; count: number }>();
  for (const b of bookings) {
    if (isCancelled(b.booking_status)) continue;
    const price = safePrice(b.price);
    if (price == null || price <= 0) continue;
    const key = keyFn(b);
    const cur = map.get(key) ?? { revenue: 0, count: 0 };
    cur.revenue += price;
    cur.count += 1;
    map.set(key, cur);
  }
  return [...map.entries()]
    .map(([key, v]) => ({
      label: labelFn ? labelFn(key) : key,
      revenue: v.revenue,
      count: v.count,
    }))
    .sort((a, b) => b.revenue - a.revenue);
}

type PaymentConsistency = {
  overpayments: number;
  partialPayments: number;
  paidStatusMismatch: number;
};

function analyzePaymentConsistency(
  bookings: FinanceBooking[],
  approvedByBooking: Map<string, number>,
): PaymentConsistency {
  let overpayments = 0;
  let partialPayments = 0;
  let paidStatusMismatch = 0;

  for (const b of bookings) {
    if (!isActiveBooking(b.booking_status)) continue;
    const price = safePrice(b.price);
    if (price == null || price <= 0) continue;

    const approvedSum = approvedByBooking.get(b.id) ?? 0;

    if (approvedSum > price) overpayments += 1;

    if (b.payment_status !== "paid" && approvedSum > 0 && approvedSum < price) {
      partialPayments += 1;
    }

    if (b.payment_status !== "paid" && approvedSum >= price) {
      paidStatusMismatch += 1;
    }
  }

  return { overpayments, partialPayments, paidStatusMismatch };
}

export function computeKPIs(
  bookings: FinanceBooking[],
  payments: FinancePayment[],
  options?: { bookingsTruncated?: boolean },
): FinanceKPIs {
  const dataWarnings: string[] = [];
  const approvedByBooking = buildApprovedMap(payments);
  const operational = bookings.filter((b) => isActiveBooking(b.booking_status));

  let revenue = 0;
  let collected = 0;
  let vehicles = 0;
  let invalidPrices = 0;
  let invalidVehicles = 0;
  const byPaymentMethod = emptyPaymentBreakdown();

  for (const b of operational) {
    const price = safePrice(b.price);
    if (price == null || price <= 0) {
      invalidPrices += 1;
      continue;
    }
    const vc = safeVehicleCount(b.vehicle_count);
    if (vc == null) invalidVehicles += 1;
    else vehicles += vc;

    revenue += price;
    collected += getBookingCollectedAmount(b, approvedByBooking);
    addToPaymentBreakdown(byPaymentMethod, b.payment_method, price);
  }

  if (invalidPrices > 0) {
    dataWarnings.push(`${invalidPrices} reserva(s) con precio inválido excluidas del revenue.`);
  }
  if (invalidVehicles > 0) {
    dataWarnings.push(`${invalidVehicles} reserva(s) con cantidad de vehículos inválida.`);
  }
  if (options?.bookingsTruncated) {
    dataWarnings.push(
      `El período supera el límite de ${FINANCE_QUERY_LIMIT} reservas; los totales pueden estar incompletos.`,
    );
  }

  const consistency = analyzePaymentConsistency(operational, approvedByBooking);
  if (consistency.overpayments > 0) {
    dataWarnings.push(
      `${consistency.overpayments} reserva(s) con pagos approved que superan el precio (revisar duplicados).`,
    );
  }

  const pending = Math.max(0, revenue - collected);
  const activeBookings = operational.filter((b) => (safePrice(b.price) ?? 0) > 0).length;

  return {
    revenue,
    collected,
    pending,
    activeBookings,
    vehicles,
    avgTicketBooking: activeBookings > 0 ? revenue / activeBookings : 0,
    avgTicketVehicle: vehicles > 0 ? revenue / vehicles : 0,
    collectedPct: revenue > 0 ? (collected / revenue) * 100 : 0,
    byPaymentMethod,
    dataWarnings,
  };
}

export function computeDailyCash(
  bookings: FinanceBooking[],
  payments: FinancePayment[],
): DailyCashRow[] {
  const approvedByBooking = buildApprovedMap(payments);
  const byDate = new Map<string, FinanceBooking[]>();

  for (const b of bookings) {
    if (isCancelled(b.booking_status)) continue;
    const list = byDate.get(b.scheduled_date) ?? [];
    list.push(b);
    byDate.set(b.scheduled_date, list);
  }

  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, dayBookings]) => {
      let revenue = 0;
      let collected = 0;
      let vehicles = 0;
      const methods = emptyPaymentBreakdown();
      let count = 0;

      for (const b of dayBookings) {
        const price = safePrice(b.price);
        if (price == null || price <= 0) continue;
        count += 1;
        revenue += price;
        vehicles += safeVehicleCount(b.vehicle_count) ?? 0;
        collected += getBookingCollectedAmount(b, approvedByBooking);
        addToPaymentBreakdown(methods, b.payment_method, price);
      }

      const pending = Math.max(0, revenue - collected);
      const collectionPct = revenue > 0 ? (collected / revenue) * 100 : 0;

      return {
        date,
        bookings: count,
        vehicles,
        revenue,
        collected,
        pending,
        mercadoPago: methods.mercadoPago,
        transferencia: methods.transferencia,
        pagarDespues: methods.pagarDespues,
        avgTicket: count > 0 ? revenue / count : 0,
        collectionPct,
      };
    });
}

export function computeAlerts(
  periodBookings: FinanceBooking[],
  allBookingsForAlerts: FinanceBooking[],
  payments: FinancePayment[],
  receipts: FinanceReceipt[],
): FinanceAlert[] {
  const alerts: FinanceAlert[] = [];
  const today = todayIso();
  const approvedByBooking = buildApprovedMap(payments);
  const receiptsByBooking = buildReceiptMap(receipts);
  const consistency = analyzePaymentConsistency(periodBookings, approvedByBooking);

  const pastPending = allBookingsForAlerts.filter(
    (b) =>
      isActiveBooking(b.booking_status) &&
      b.scheduled_date < today &&
      b.payment_status === "pending",
  );
  if (pastPending.length > 0) {
    alerts.push({
      id: "past-pending",
      severity: "warning",
      count: pastPending.length,
      message: `${pastPending.length} reserva(s) pasada(s) con pago pendiente`,
    });
  }

  const transferUnpaid = periodBookings.filter(
    (b) =>
      isActiveBooking(b.booking_status) &&
      normalizePaymentMethod(b.payment_method) === "transfer" &&
      b.payment_status !== "paid",
  );
  if (transferUnpaid.length > 0) {
    alerts.push({
      id: "transfer-unpaid",
      severity: "warning",
      count: transferUnpaid.length,
      message: `${transferUnpaid.length} transferencia(s) sin marcar como pagadas`,
    });
  }

  const transferNeedsReceipt = transferUnpaid.filter((b) => {
    const list = receiptsByBooking.get(b.id) ?? [];
    return !list.some((r) => r.status === "approved");
  });
  if (transferNeedsReceipt.length > 0) {
    alerts.push({
      id: "transfer-no-receipt",
      severity: "warning",
      count: transferNeedsReceipt.length,
      message: `${transferNeedsReceipt.length} transferencia(s) pendientes requieren revisión de comprobante`,
    });
  }

  const transferBadReceipt = periodBookings.filter((b) => {
    if (!isActiveBooking(b.booking_status)) return false;
    if (normalizePaymentMethod(b.payment_method) !== "transfer") return false;
    const list = receiptsByBooking.get(b.id) ?? [];
    return list.some((r) => r.status === "pending_review" || r.status === "rejected");
  });
  if (transferBadReceipt.length > 0) {
    alerts.push({
      id: "transfer-receipt-review",
      severity: "warning",
      count: transferBadReceipt.length,
      message: `${transferBadReceipt.length} transferencia(s) con comprobante pendiente o rechazado`,
    });
  }

  const dupPayments = new Map<string, number>();
  for (const p of payments) {
    if (p.status !== "approved" || !p.booking_id) continue;
    dupPayments.set(p.booking_id, (dupPayments.get(p.booking_id) ?? 0) + 1);
  }
  const duplicateCount = [...dupPayments.values()].filter((c) => c > 1).length;
  if (duplicateCount > 0) {
    alerts.push({
      id: "dup-payments",
      severity: "warning",
      count: duplicateCount,
      message: `${duplicateCount} reserva(s) con posibles pagos duplicados (más de un pago aprobado)`,
    });
  }

  if (consistency.overpayments > 0) {
    alerts.push({
      id: "overpayments",
      severity: "warning",
      count: consistency.overpayments,
      message: `${consistency.overpayments} reserva(s) con sobrepago (pagos approved superan el precio)`,
    });
  }

  if (consistency.partialPayments > 0) {
    alerts.push({
      id: "partial-payments",
      severity: "info",
      count: consistency.partialPayments,
      message: `${consistency.partialPayments} reserva(s) con cobro parcial registrado`,
    });
  }

  const orphanPayments = payments.filter((p) => !p.booking_id);
  if (orphanPayments.length > 0) {
    alerts.push({
      id: "orphan-payments",
      severity: "info",
      count: orphanPayments.length,
      message: `${orphanPayments.length} pago(s) sin reserva asociada`,
    });
  }

  const badPrice = periodBookings.filter(
    (b) => isActiveBooking(b.booking_status) && (safePrice(b.price) == null || b.price <= 0),
  );
  if (badPrice.length > 0) {
    alerts.push({
      id: "bad-price",
      severity: "warning",
      count: badPrice.length,
      message: `${badPrice.length} reserva(s) con precio $0 o faltante`,
    });
  }

  const badVehicles = periodBookings.filter(
    (b) => isActiveBooking(b.booking_status) && safeVehicleCount(b.vehicle_count) == null,
  );
  if (badVehicles.length > 0) {
    alerts.push({
      id: "bad-vehicles",
      severity: "info",
      count: badVehicles.length,
      message: `${badVehicles.length} reserva(s) con cantidad de vehículos inválida`,
    });
  }

  if (consistency.paidStatusMismatch > 0) {
    alerts.push({
      id: "paid-mismatch",
      severity: "info",
      count: consistency.paidStatusMismatch,
      message: `${consistency.paidStatusMismatch} reserva(s) con pago completo aprobado pero estado no actualizado a pagado`,
    });
  }

  return alerts;
}

export function computePlanilla(
  kpis: FinanceKPIs,
  dailyCash: DailyCashRow[],
  assumptions: PlanillaAssumptions,
  realOpex?: { washeroExpensesTotal: number },
): PlanillaResult {
  const activeDays = dailyCash.filter((d) => d.bookings > 0).length;
  const mpRevenue = kpis.byPaymentMethod.mercadoPago;

  const mpCommissions = mpRevenue * (assumptions.mercadoPagoCommissionPct / 100);
  const variableCosts = kpis.vehicles * assumptions.variableCostPerVehicle;
  const operatorCosts =
    assumptions.operatorCostMode === "per_day"
      ? activeDays * assumptions.operatorCostPerDay
      : kpis.vehicles * assumptions.operatorCostPerVehicle;
  const logisticsCosts = activeDays * assumptions.logisticsCostPerDay;

  // Prefer real Washero OpEx from the sheet when present; otherwise keep fixedCostsPeriod guess.
  const fixedOrReal =
    realOpex && realOpex.washeroExpensesTotal > 0
      ? realOpex.washeroExpensesTotal
      : assumptions.fixedCostsPeriod;

  const grossMargin =
    kpis.revenue -
    mpCommissions -
    variableCosts -
    operatorCosts -
    logisticsCosts -
    fixedOrReal;

  const truckOwnerPayment = grossMargin * (assumptions.truckOwnerPct / 100);
  const netCash = grossMargin - truckOwnerPayment + assumptions.manualAdjustment;
  const washeroCash = netCash * (assumptions.washeroCashPct / 100);
  const distributableResult = netCash - washeroCash;

  return {
    revenue: kpis.revenue,
    mpCommissions,
    variableCosts,
    operatorCosts,
    logisticsCosts,
    truckOwnerPayment,
    netCash,
    washeroCash,
    distributableResult,
    activeDays,
  };
}

export function computeFinanceData(
  bookings: FinanceBooking[],
  payments: FinancePayment[],
  receipts: FinanceReceipt[],
  alertBookings: FinanceBooking[],
  assumptions: PlanillaAssumptions,
  options?: { bookingsTruncated?: boolean; washeroExpensesTotal?: number },
): FinanceComputed {
  const kpis = computeKPIs(bookings, payments, options);
  const dailyCash = computeDailyCash(bookings, payments);
  const alerts = computeAlerts(bookings, alertBookings, payments, receipts);
  const planilla = computePlanilla(kpis, dailyCash, assumptions, {
    washeroExpensesTotal: options?.washeroExpensesTotal ?? 0,
  });

  const operational = bookings.filter((b) => isActiveBooking(b.booking_status));

  return {
    kpis,
    dailyCash,
    alerts,
    byPaymentMethod: [
      { label: "MercadoPago", revenue: kpis.byPaymentMethod.mercadoPago, count: 0 },
      { label: "Transferencia", revenue: kpis.byPaymentMethod.transferencia, count: 0 },
      { label: "Pagar después", revenue: kpis.byPaymentMethod.pagarDespues, count: 0 },
      ...(kpis.byPaymentMethod.other > 0
        ? [{ label: "Otros", revenue: kpis.byPaymentMethod.other, count: 0 }]
        : []),
    ],
    byBookingStatus: aggregateBreakdown(
      operational,
      (b) => b.booking_status,
      (k) => bookingStatusLabels[k] ?? k,
    ),
    byBookingSource: aggregateBreakdown(
      operational,
      (b) => b.booking_source,
      (k) => bookingSourceLabels[k] ?? k,
    ),
    topNeighborhoods: aggregateBreakdown(operational, (b) =>
      zoneLabel(b.neighborhood, b.private_neighborhood_name),
    ).slice(0, 8),
    topDays: dailyCash
      .map((d) => ({ label: d.date, revenue: d.revenue, count: d.bookings }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 8),
    planilla,
  };
}

export function receiptStatusByBooking(receipts: FinanceReceipt[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const r of receipts) {
    if (!r.booking_id) continue;
    const prev = map.get(r.booking_id);
    if (!prev || r.status === "approved") map.set(r.booking_id, r.status);
  }
  return map;
}
