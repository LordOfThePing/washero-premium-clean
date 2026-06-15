import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarOff, Loader2 } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { FinanceHeader } from "@/components/admin/finance/FinanceHeader";
import { FinanceKPIs } from "@/components/admin/finance/FinanceKPIs";
import { DailyCashTable } from "@/components/admin/finance/DailyCashTable";
import { FinanceAlerts } from "@/components/admin/finance/FinanceAlerts";
import { FinanceBreakdown } from "@/components/admin/finance/FinanceBreakdown";
import { PlanillaOperativa } from "@/components/admin/finance/PlanillaOperativa";
import { BookingsDetailTable } from "@/components/admin/finance/BookingsDetailTable";
import { FinanceSection } from "@/components/admin/finance/FinanceSection";
import {
  computeFinanceData,
  receiptStatusByBooking,
  exportDailyCashCsv,
  exportBookingsCsv,
  exportPlanillaXls,
  getPeriodRange,
  loadPlanillaAssumptions,
  savePlanillaAssumptions,
  resetPlanillaAssumptions,
  todayIso,
  FINANCE_QUERY_LIMIT,
  type FinanceBooking,
  type FinancePayment,
  type FinanceReceipt,
  type PeriodPreset,
  type PlanillaAssumptions,
} from "@/lib/finance";

export const Route = createFileRoute("/admin/finanzas")({
  component: FinanzasPage,
});

const BOOKING_SELECT =
  "id, price, payment_method, payment_status, booking_status, scheduled_date, scheduled_time, customer_name, customer_phone, neighborhood, private_neighborhood_name, service_name, vehicle_count, booking_source, marketing_source, created_at";

const PAYMENT_SELECT = "id, amount, booking_id, provider, status, created_at";
const RECEIPT_SELECT = "id, booking_id, status, created_at";
const ID_CHUNK = 200;

async function fetchInChunks<T>(
  ids: string[],
  fetchChunk: (chunk: string[]) => Promise<T[]>,
): Promise<T[]> {
  const all: T[] = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const chunk = ids.slice(i, i + ID_CHUNK);
    if (chunk.length === 0) continue;
    all.push(...(await fetchChunk(chunk)));
  }
  return all;
}

async function fetchPaymentsForBookings(bookingIds: string[]): Promise<FinancePayment[]> {
  const byId = new Map<string, FinancePayment>();

  const linked = await fetchInChunks(bookingIds, async (chunk) => {
    const { data, error } = await supabase
      .from("payments")
      .select(PAYMENT_SELECT)
      .in("booking_id", chunk);
    if (error) throw error;
    return (data ?? []) as FinancePayment[];
  });
  for (const p of linked) byId.set(p.id, p);

  const { data: orphans, error: orphanErr } = await supabase
    .from("payments")
    .select(PAYMENT_SELECT)
    .is("booking_id", null)
    .order("created_at", { ascending: false })
    .limit(500);
  if (orphanErr) throw orphanErr;
  for (const p of (orphans ?? []) as FinancePayment[]) byId.set(p.id, p);

  return [...byId.values()];
}

async function fetchReceiptsForBookings(bookingIds: string[]): Promise<FinanceReceipt[]> {
  if (bookingIds.length === 0) return [];
  return fetchInChunks(bookingIds, async (chunk) => {
    const { data, error } = await supabase
      .from("payment_receipts")
      .select(RECEIPT_SELECT)
      .in("booking_id", chunk);
    if (error) throw error;
    return (data ?? []) as FinanceReceipt[];
  });
}

async function fetchFinanceData(from: string, to: string) {
  const today = todayIso();

  const bookingsRes = await supabase
    .from("bookings")
    .select(BOOKING_SELECT)
    .gte("scheduled_date", from)
    .lte("scheduled_date", to)
    .order("scheduled_date", { ascending: true })
    .order("scheduled_time", { ascending: true })
    .limit(FINANCE_QUERY_LIMIT);

  if (bookingsRes.error) throw bookingsRes.error;

  const bookings = (bookingsRes.data ?? []) as FinanceBooking[];
  const bookingsTruncated = bookings.length >= FINANCE_QUERY_LIMIT;
  const bookingIds = bookings.map((b) => b.id);

  const [payments, receipts, alertBookingsRes] = await Promise.all([
    fetchPaymentsForBookings(bookingIds),
    fetchReceiptsForBookings(bookingIds),
    supabase
      .from("bookings")
      .select(BOOKING_SELECT)
      .lt("scheduled_date", today)
      .eq("payment_status", "pending")
      .neq("booking_status", "cancelled")
      .limit(500),
  ]);

  if (alertBookingsRes.error) throw alertBookingsRes.error;

  return {
    bookings,
    payments,
    receipts,
    alertBookings: (alertBookingsRes.data ?? []) as FinanceBooking[],
    bookingsTruncated,
  };
}

function FinanzasPage() {
  const qc = useQueryClient();
  const [period, setPeriod] = useState<PeriodPreset>("month");
  const [customFrom, setCustomFrom] = useState(todayIso());
  const [customTo, setCustomTo] = useState(todayIso());
  const [assumptions, setAssumptions] = useState<PlanillaAssumptions>(() =>
    loadPlanillaAssumptions(),
  );

  const range = useMemo(
    () => getPeriodRange(period, customFrom, customTo),
    [period, customFrom, customTo],
  );

  const periodLabel = `${range.from}_${range.to}`;

  const query = useQuery({
    queryKey: ["admin", "finanzas", range.from, range.to],
    queryFn: () => fetchFinanceData(range.from, range.to),
  });

  const computed = useMemo(() => {
    if (!query.data) return null;
    return computeFinanceData(
      query.data.bookings,
      query.data.payments,
      query.data.receipts,
      query.data.alertBookings,
      assumptions,
      { bookingsTruncated: query.data.bookingsTruncated },
    );
  }, [query.data, assumptions]);

  const receiptsMap = useMemo(
    () => (query.data ? receiptStatusByBooking(query.data.receipts) : new Map()),
    [query.data],
  );

  const handleAssumptionsChange = (next: PlanillaAssumptions) => {
    setAssumptions(next);
    savePlanillaAssumptions(next);
  };

  const handleResetAssumptions = () => {
    const defaults = resetPlanillaAssumptions();
    setAssumptions(defaults);
  };

  const handleRetry = () => {
    qc.invalidateQueries({ queryKey: ["admin", "finanzas"] });
  };

  if (query.isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Cargando finanzas…
        </div>
        <Skeleton className="h-10 w-64" />
        <div className="grid gap-3 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
        <Skeleton className="h-48" />
      </div>
    );
  }

  if (query.isError) {
    return (
      <div className="space-y-4 rounded-lg border border-destructive/40 bg-destructive/5 p-6">
        <p className="text-sm font-medium">No pudimos cargar finanzas</p>
        <p className="text-sm text-muted-foreground">{(query.error as Error).message}</p>
        <Button variant="outline" size="sm" onClick={handleRetry}>
          Reintentar
        </Button>
      </div>
    );
  }

  const data = query.data!;
  const fin = computed!;
  const isEmptyPeriod = data.bookings.filter((b) => b.booking_status !== "cancelled").length === 0;

  return (
    <div className="space-y-8">
      <FinanceHeader
        period={period}
        periodFrom={range.from}
        periodTo={range.to}
        customFrom={customFrom}
        customTo={customTo}
        onPeriodChange={setPeriod}
        onCustomFromChange={setCustomFrom}
        onCustomToChange={setCustomTo}
        onRefresh={handleRetry}
        isRefreshing={query.isFetching}
        exportDisabled={!computed}
        onExportDailyCash={() => exportDailyCashCsv(fin.dailyCash, periodLabel)}
        onExportBookings={() => exportBookingsCsv(data.bookings, periodLabel)}
        onExportPlanilla={() => exportPlanillaXls(fin, data.bookings, assumptions, periodLabel)}
      />

      {query.isFetching && !query.isLoading && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> Actualizando datos…
        </div>
      )}

      {isEmptyPeriod && (
        <div className="flex items-center gap-3 rounded-lg border border-dashed bg-muted/30 px-4 py-3 text-sm">
          <CalendarOff className="h-5 w-5 shrink-0 text-muted-foreground" />
          <p className="text-muted-foreground">
            No hay reservas activas en este período. Cambiá el filtro de fechas para ver datos.
          </p>
        </div>
      )}

      <FinanceSection
        title="Resumen"
        description="Lo esencial: cuánto se vendió, cuánto entró y cuánto falta cobrar."
      >
        <FinanceKPIs kpis={fin.kpis} />
      </FinanceSection>

      <FinanceAlerts alerts={fin.alerts} />

      <DailyCashTable rows={fin.dailyCash} />

      <FinanceBreakdown
        byPaymentMethod={fin.byPaymentMethod}
        byBookingStatus={fin.byBookingStatus}
        byBookingSource={fin.byBookingSource}
        topNeighborhoods={fin.topNeighborhoods}
        topDays={fin.topDays}
      />

      <PlanillaOperativa
        assumptions={assumptions}
        result={fin.planilla}
        onChange={handleAssumptionsChange}
        onReset={handleResetAssumptions}
      />

      <BookingsDetailTable bookings={data.bookings} receiptStatusByBooking={receiptsMap} />
    </div>
  );
}
