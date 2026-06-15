import {
  bookingSourceLabels,
  paymentStatusLabels,
  bookingStatusLabels,
} from "@/lib/booking-badges";
import type {
  DailyCashRow,
  FinanceBooking,
  FinanceComputed,
  PlanillaAssumptions,
  PlanillaResult,
} from "./types";
import { csvEscape, downloadBlob, fmtCurrency, fmtDate, htmlEscape, zoneLabel } from "./utils";

function rowsToCsv(headers: string[], rows: (string | number)[][]): string {
  const lines = [headers.map(csvEscape).join(",")];
  for (const row of rows) {
    lines.push(row.map(csvEscape).join(","));
  }
  return lines.join("\n");
}

export function exportDailyCashCsv(dailyCash: DailyCashRow[], periodLabel: string) {
  const headers = [
    "Fecha",
    "Reservas",
    "Vehículos",
    "Revenue",
    "Cobrado",
    "Pendiente",
    "MercadoPago",
    "Transferencia",
    "Pagar después",
    "Ticket promedio",
    "% cobrado",
  ];
  const rows = dailyCash.map((d) => [
    fmtDate(d.date),
    d.bookings,
    d.vehicles,
    d.revenue,
    d.collected,
    d.pending,
    d.mercadoPago,
    d.transferencia,
    d.pagarDespues,
    Math.round(d.avgTicket),
    d.collectionPct.toFixed(1),
  ]);
  const csv = rowsToCsv(headers, rows);
  downloadBlob(csv, `caja-diaria-${periodLabel}.csv`, "text/csv;charset=utf-8");
}

export function exportBookingsCsv(bookings: FinanceBooking[], periodLabel: string) {
  const headers = [
    "Fecha",
    "Hora",
    "Cliente",
    "Teléfono",
    "Zona",
    "Servicio",
    "Vehículos",
    "Precio",
    "Método de pago",
    "Estado pago",
    "Estado reserva",
    "Origen",
  ];
  const rows = bookings
    .filter((b) => b.booking_status !== "cancelled")
    .sort((a, b) =>
      a.scheduled_date === b.scheduled_date
        ? a.scheduled_time.localeCompare(b.scheduled_time)
        : a.scheduled_date.localeCompare(b.scheduled_date),
    )
    .map((b) => [
      fmtDate(b.scheduled_date),
      b.scheduled_time,
      b.customer_name,
      b.customer_phone,
      zoneLabel(b.neighborhood, b.private_neighborhood_name),
      b.service_name,
      b.vehicle_count,
      b.price,
      b.payment_method,
      paymentStatusLabels[b.payment_status] ?? b.payment_status,
      bookingStatusLabels[b.booking_status] ?? b.booking_status,
      bookingSourceLabels[b.booking_source] ?? b.booking_source,
    ]);
  const csv = rowsToCsv(headers, rows);
  downloadBlob(csv, `reservas-finanzas-${periodLabel}.csv`, "text/csv;charset=utf-8");
}

function htmlTable(title: string, headers: string[], rows: (string | number)[][]) {
  const th = headers.map((h) => `<th>${htmlEscape(h)}</th>`).join("");
  const trs = rows
    .map((row) => `<tr>${row.map((c) => `<td>${htmlEscape(c)}</td>`).join("")}</tr>`)
    .join("");
  return `<h2>${htmlEscape(title)}</h2><table border="1"><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table><br/>`;
}

function planillaSection(
  kpis: FinanceComputed["kpis"],
  planilla: PlanillaResult,
  assumptions: PlanillaAssumptions,
) {
  const rows: (string | number)[][] = [
    ["Revenue operativo", fmtCurrency(kpis.revenue)],
    ["Comisión MercadoPago %", `${assumptions.mercadoPagoCommissionPct}%`],
    ["Comisiones MP estimadas", fmtCurrency(planilla.mpCommissions)],
    ["Costo variable por vehículo", fmtCurrency(assumptions.variableCostPerVehicle)],
    ["Costos variables estimados", fmtCurrency(planilla.variableCosts)],
    [
      "Costo operador (modo)",
      assumptions.operatorCostMode === "per_day" ? "Por día" : "Por vehículo",
    ],
    ["Costos operador estimados", fmtCurrency(planilla.operatorCosts)],
    ["Logística por día", fmtCurrency(assumptions.logisticsCostPerDay)],
    ["Costos logística estimados", fmtCurrency(planilla.logisticsCosts)],
    ["% dueño camioneta", `${assumptions.truckOwnerPct}%`],
    ["Pago estimado dueño camioneta", fmtCurrency(planilla.truckOwnerPayment)],
    ["Gastos fijos del período", fmtCurrency(assumptions.fixedCostsPeriod)],
    ["Ajuste manual", fmtCurrency(assumptions.manualAdjustment)],
    ["Caja neta estimada", fmtCurrency(planilla.netCash)],
    [`Caja Washero (${assumptions.washeroCashPct}%)`, fmtCurrency(planilla.washeroCash)],
    ["Resultado distribuible estimado", fmtCurrency(planilla.distributableResult)],
  ];
  return htmlTable("Planilla operativa", ["Concepto", "Valor"], rows);
}

export function exportPlanillaXls(
  computed: FinanceComputed,
  bookings: FinanceBooking[],
  assumptions: PlanillaAssumptions,
  periodLabel: string,
) {
  const { kpis, dailyCash, planilla } = computed;

  const summaryRows: (string | number)[][] = [
    ["Revenue operativo", fmtCurrency(kpis.revenue)],
    ["Cobrado", fmtCurrency(kpis.collected)],
    ["Pendiente", fmtCurrency(kpis.pending)],
    ["Reservas activas", kpis.activeBookings],
    ["Vehículos", kpis.vehicles],
    ["Ticket promedio reserva", fmtCurrency(kpis.avgTicketBooking)],
    ["Ticket promedio vehículo", fmtCurrency(kpis.avgTicketVehicle)],
    ["% cobrado", `${kpis.collectedPct.toFixed(1)}%`],
    ["MercadoPago", fmtCurrency(kpis.byPaymentMethod.mercadoPago)],
    ["Transferencia", fmtCurrency(kpis.byPaymentMethod.transferencia)],
    ["Pagar después", fmtCurrency(kpis.byPaymentMethod.pagarDespues)],
  ];

  const cajaHeaders = [
    "Fecha",
    "Reservas",
    "Vehículos",
    "Revenue",
    "Cobrado",
    "Pendiente",
    "MP",
    "Transferencia",
    "Pagar después",
    "Ticket prom.",
    "% cobrado",
  ];
  const cajaRows = dailyCash.map((d) => [
    fmtDate(d.date),
    d.bookings,
    d.vehicles,
    fmtCurrency(d.revenue),
    fmtCurrency(d.collected),
    fmtCurrency(d.pending),
    fmtCurrency(d.mercadoPago),
    fmtCurrency(d.transferencia),
    fmtCurrency(d.pagarDespues),
    fmtCurrency(d.avgTicket),
    `${d.collectionPct.toFixed(1)}%`,
  ]);

  const bookingRows = bookings
    .filter((b) => b.booking_status !== "cancelled")
    .map((b) => [
      fmtDate(b.scheduled_date),
      b.scheduled_time,
      b.customer_name,
      b.customer_phone,
      zoneLabel(b.neighborhood, b.private_neighborhood_name),
      b.service_name,
      b.vehicle_count,
      fmtCurrency(b.price),
      b.payment_method,
      paymentStatusLabels[b.payment_status] ?? b.payment_status,
      bookingStatusLabels[b.booking_status] ?? b.booking_status,
      bookingSourceLabels[b.booking_source] ?? b.booking_source,
    ]);

  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office"
xmlns:x="urn:schemas-microsoft-com:office:excel"
xmlns="http://www.w3.org/TR/REC-html40">
<head><meta http-equiv="Content-Type" content="text/html; charset=UTF-8"></head>
<body>
${htmlTable("Resumen", ["Indicador", "Valor"], summaryRows)}
${htmlTable("Caja diaria", cajaHeaders, cajaRows)}
${planillaSection(kpis, planilla, assumptions)}
${htmlTable(
  "Reservas",
  [
    "Fecha",
    "Hora",
    "Cliente",
    "Teléfono",
    "Zona",
    "Servicio",
    "Veh.",
    "Precio",
    "Método",
    "Pago",
    "Reserva",
    "Origen",
  ],
  bookingRows,
)}
</body></html>`;

  downloadBlob(
    html,
    `planilla-finanzas-${periodLabel}.xls`,
    "application/vnd.ms-excel;charset=utf-8",
  );
}
