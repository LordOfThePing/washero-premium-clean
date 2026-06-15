import { AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { FinanceKPIs } from "@/lib/finance/types";
import { fmtCurrency, fmtPct } from "@/lib/finance/utils";

type Props = { kpis: FinanceKPIs };

export function FinanceKPIs({ kpis }: Props) {
  const cards = [
    { label: "Revenue operativo", value: fmtCurrency(kpis.revenue), highlight: true },
    { label: "Cobrado", value: fmtCurrency(kpis.collected) },
    { label: "Pendiente de cobro", value: fmtCurrency(kpis.pending) },
    { label: "Reservas activas", value: String(kpis.activeBookings), isCount: true },
    { label: "Vehículos", value: String(kpis.vehicles), isCount: true },
    { label: "Ticket prom. / reserva", value: fmtCurrency(kpis.avgTicketBooking) },
    { label: "Ticket prom. / vehículo", value: fmtCurrency(kpis.avgTicketVehicle) },
    { label: "% cobrado", value: fmtPct(kpis.collectedPct) },
    { label: "MercadoPago", value: fmtCurrency(kpis.byPaymentMethod.mercadoPago) },
    { label: "Transferencia", value: fmtCurrency(kpis.byPaymentMethod.transferencia) },
    { label: "Pagar después", value: fmtCurrency(kpis.byPaymentMethod.pagarDespues) },
  ];

  return (
    <div className="space-y-3">
      {kpis.dataWarnings.length > 0 && (
        <Alert variant="default" className="border-amber-500/40 bg-amber-500/5">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          <AlertDescription className="text-sm">{kpis.dataWarnings.join(" ")}</AlertDescription>
        </Alert>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {cards.map((c) => (
          <Card key={c.label} className={c.highlight ? "border-primary/30" : undefined}>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-normal text-muted-foreground">{c.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className={`font-semibold ${c.isCount ? "text-2xl" : "text-xl"}`}>{c.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
