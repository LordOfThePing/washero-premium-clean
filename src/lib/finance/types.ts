import type { Database } from "@/integrations/db/types";

export type FinanceBooking = Pick<
  Database["public"]["Tables"]["bookings"]["Row"],
  | "id"
  | "price"
  | "payment_method"
  | "payment_status"
  | "booking_status"
  | "scheduled_date"
  | "scheduled_time"
  | "customer_name"
  | "customer_phone"
  | "neighborhood"
  | "private_neighborhood_name"
  | "service_name"
  | "vehicle_count"
  | "booking_source"
  | "marketing_source"
  | "created_at"
>;

export type FinancePayment = Pick<
  Database["public"]["Tables"]["payments"]["Row"],
  "id" | "amount" | "booking_id" | "provider" | "status" | "created_at"
>;

export type FinanceReceipt = Pick<
  Database["public"]["Tables"]["payment_receipts"]["Row"],
  "id" | "booking_id" | "status" | "created_at"
>;

export type PeriodPreset = "today" | "next7" | "last7" | "month" | "last30" | "custom";

export type PeriodRange = { from: string; to: string };

export type PaymentMethodBreakdown = {
  mercadoPago: number;
  transferencia: number;
  pagarDespues: number;
  other: number;
};

export type FinanceKPIs = {
  revenue: number;
  collected: number;
  pending: number;
  activeBookings: number;
  vehicles: number;
  avgTicketBooking: number;
  avgTicketVehicle: number;
  collectedPct: number;
  byPaymentMethod: PaymentMethodBreakdown;
  dataWarnings: string[];
};

export type DailyCashRow = {
  date: string;
  bookings: number;
  vehicles: number;
  revenue: number;
  collected: number;
  pending: number;
  mercadoPago: number;
  transferencia: number;
  pagarDespues: number;
  avgTicket: number;
  collectionPct: number;
};

export type FinanceAlert = {
  id: string;
  severity: "warning" | "info";
  message: string;
  count: number;
};

export type BreakdownItem = { label: string; revenue: number; count: number };

export type PlanillaAssumptions = {
  variableCostPerVehicle: number;
  mercadoPagoCommissionPct: number;
  operatorCostPerVehicle: number;
  operatorCostPerDay: number;
  operatorCostMode: "per_vehicle" | "per_day";
  logisticsCostPerDay: number;
  truckOwnerPct: number;
  washeroCashPct: number;
  fixedCostsPeriod: number;
  manualAdjustment: number;
};

export type PlanillaResult = {
  revenue: number;
  mpCommissions: number;
  variableCosts: number;
  operatorCosts: number;
  logisticsCosts: number;
  truckOwnerPayment: number;
  netCash: number;
  washeroCash: number;
  distributableResult: number;
  activeDays: number;
};

export type FinanceComputed = {
  kpis: FinanceKPIs;
  dailyCash: DailyCashRow[];
  alerts: FinanceAlert[];
  byPaymentMethod: BreakdownItem[];
  byBookingStatus: BreakdownItem[];
  byBookingSource: BreakdownItem[];
  topNeighborhoods: BreakdownItem[];
  topDays: BreakdownItem[];
  planilla: PlanillaResult;
};

/** Real OpEx from Washero-paid sheet rows for the selected period. */
export type RealOpexInput = {
  washeroExpensesTotal: number;
};
