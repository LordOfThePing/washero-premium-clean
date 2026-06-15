import { AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { FinanceKPIs } from "@/lib/finance/types";
import { fmtCurrency, fmtPct } from "@/lib/finance/utils";

type Props = { kpis: FinanceKPIs };

export function FinanceKPIs({ kpis }: Props) {
  const hero = [
    {
      label: "Vendido en el período",
      hint: "Suma de reservas activas (sin canceladas)",
      value: fmtCurrency(kpis.revenue),
      accent: "border-primary/40 bg-primary/5",
      valueClass: "text-2xl sm:text-3xl",
    },
    {
      label: "Cobrado",
      hint: "Pagos confirmados o marcados como pagados",
      value: fmtCurrency(kpis.collected),
      accent: "border-green-500/30 bg-green-500/5",
      valueClass: "text-2xl sm:text-3xl text-green-700 dark:text-green-400",
    },
    {
      label: "Falta cobrar",
      hint: "Diferencia entre vendido y cobrado",
      value: fmtCurrency(kpis.pending),
      accent: "border-amber-500/30 bg-amber-500/5",
      valueClass: "text-2xl sm:text-3xl text-amber-700 dark:text-amber-400",
    },
  ];

  const secondary = [
    { label: "% cobrado", value: fmtPct(kpis.collectedPct) },
    { label: "Reservas", value: String(kpis.activeBookings) },
    { label: "Vehículos", value: String(kpis.vehicles) },
    { label: "Ticket / reserva", value: fmtCurrency(kpis.avgTicketBooking) },
    { label: "Ticket / vehículo", value: fmtCurrency(kpis.avgTicketVehicle) },
  ];

  const byMethod = [
    { label: "Mercado Pago", value: fmtCurrency(kpis.byPaymentMethod.mercadoPago) },
    { label: "Transferencia", value: fmtCurrency(kpis.byPaymentMethod.transferencia) },
    { label: "Pagar después", value: fmtCurrency(kpis.byPaymentMethod.pagarDespues) },
  ];

  return (
    <div className="space-y-4">
      {kpis.dataWarnings.length > 0 && (
        <Alert variant="default" className="border-amber-500/50 bg-amber-500/10">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          <AlertDescription>
            <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
              Revisá estos datos antes de confiar en los totales:
            </p>
            <ul className="mt-1.5 list-inside list-disc space-y-0.5 text-sm text-amber-900/90 dark:text-amber-200/90">
              {kpis.dataWarnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        {hero.map((c) => (
          <Card key={c.label} className={c.accent}>
            <CardHeader className="pb-1">
              <CardTitle className="text-sm font-medium">{c.label}</CardTitle>
              <p className="text-[11px] text-muted-foreground">{c.hint}</p>
            </CardHeader>
            <CardContent>
              <div className={`font-semibold tabular-nums ${c.valueClass}`}>{c.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {secondary.map((c) => (
          <Card key={c.label} className="shadow-none">
            <CardContent className="p-3">
              <p className="text-[11px] text-muted-foreground">{c.label}</p>
              <p className="mt-0.5 text-sm font-semibold tabular-nums">{c.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="border-dashed shadow-none">
        <CardHeader className="pb-2 pt-4">
          <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Vendido por método de pago
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-2 pb-4 sm:grid-cols-3">
          {byMethod.map((c) => (
            <div
              key={c.label}
              className="flex items-center justify-between rounded-md bg-muted/40 px-3 py-2 text-sm sm:flex-col sm:items-start sm:gap-0.5"
            >
              <span className="text-muted-foreground">{c.label}</span>
              <span className="font-medium tabular-nums">{c.value}</span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
