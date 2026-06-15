import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { DailyCashRow } from "@/lib/finance/types";
import { fmtCurrency, fmtDate, fmtPct } from "@/lib/finance/utils";

type Props = { rows: DailyCashRow[] };

function collectionBadge(pct: number) {
  if (pct >= 90)
    return <Badge className="bg-green-600 hover:bg-green-600 dark:bg-green-700">Al día</Badge>;
  if (pct >= 60)
    return (
      <Badge className="bg-amber-100 text-amber-900 hover:bg-amber-100 dark:bg-amber-500/20 dark:text-amber-200">
        Parcial
      </Badge>
    );
  if (pct > 0)
    return (
      <Badge variant="outline" className="border-amber-500/50 text-amber-700 dark:text-amber-300">
        Bajo
      </Badge>
    );
  return <Badge variant="destructive">Sin cobros</Badge>;
}

export function DailyCashTable({ rows }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Caja por día</CardTitle>
        <p className="text-sm text-muted-foreground">
          Cuánto se vendió, cobró y falta cobrar en cada fecha del período.
        </p>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <div className="rounded-md border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
            No hay reservas en este período. Probá ampliar el rango de fechas.
          </div>
        ) : (
          <>
            <div className="hidden overflow-x-auto lg:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha</TableHead>
                    <TableHead className="text-right">Reservas</TableHead>
                    <TableHead className="text-right">Vehículos</TableHead>
                    <TableHead className="text-right">Vendido</TableHead>
                    <TableHead className="text-right">Cobrado</TableHead>
                    <TableHead className="text-right">Falta cobrar</TableHead>
                    <TableHead className="text-right">MP</TableHead>
                    <TableHead className="text-right">Transf.</TableHead>
                    <TableHead className="text-right">Después</TableHead>
                    <TableHead className="text-right">Ticket prom.</TableHead>
                    <TableHead>Cobranza</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((d) => (
                    <TableRow key={d.date}>
                      <TableCell className="whitespace-nowrap font-medium">
                        {fmtDate(d.date)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{d.bookings}</TableCell>
                      <TableCell className="text-right tabular-nums">{d.vehicles}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtCurrency(d.revenue)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-green-700 dark:text-green-400">
                        {fmtCurrency(d.collected)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-amber-700 dark:text-amber-400">
                        {fmtCurrency(d.pending)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtCurrency(d.mercadoPago)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtCurrency(d.transferencia)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtCurrency(d.pagarDespues)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtCurrency(d.avgTicket)}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          {collectionBadge(d.collectionPct)}
                          <span className="text-xs text-muted-foreground">
                            {fmtPct(d.collectionPct)}
                          </span>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="space-y-3 lg:hidden">
              {rows.map((d) => (
                <div key={d.date} className="rounded-lg border p-3 text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium">{fmtDate(d.date)}</p>
                      <p className="text-xs text-muted-foreground">
                        {d.bookings} reserva{d.bookings !== 1 ? "s" : ""} · {d.vehicles} veh.
                      </p>
                    </div>
                    <div className="text-right">
                      {collectionBadge(d.collectionPct)}
                      <p className="mt-1 text-xs text-muted-foreground">
                        {fmtPct(d.collectionPct)}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <p className="text-muted-foreground">Vendido</p>
                      <p className="font-medium tabular-nums">{fmtCurrency(d.revenue)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Cobrado</p>
                      <p className="font-medium tabular-nums text-green-700 dark:text-green-400">
                        {fmtCurrency(d.collected)}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Falta</p>
                      <p className="font-medium tabular-nums text-amber-700 dark:text-amber-400">
                        {fmtCurrency(d.pending)}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
