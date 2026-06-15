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
  if (pct >= 90) return <Badge className="bg-green-600 hover:bg-green-600">Al día</Badge>;
  if (pct >= 60) return <Badge variant="secondary">Parcial</Badge>;
  if (pct > 0) return <Badge variant="outline">Bajo</Badge>;
  return <Badge variant="destructive">Sin cobros</Badge>;
}

export function DailyCashTable({ rows }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Caja diaria</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No hay movimientos en el período seleccionado.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead className="text-right">Reservas</TableHead>
                <TableHead className="text-right">Vehículos</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
                <TableHead className="text-right">Cobrado</TableHead>
                <TableHead className="text-right">Pendiente</TableHead>
                <TableHead className="text-right">MP</TableHead>
                <TableHead className="text-right">Transf.</TableHead>
                <TableHead className="text-right">Después</TableHead>
                <TableHead className="text-right">Ticket prom.</TableHead>
                <TableHead>Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((d) => (
                <TableRow key={d.date}>
                  <TableCell className="whitespace-nowrap font-medium">{fmtDate(d.date)}</TableCell>
                  <TableCell className="text-right">{d.bookings}</TableCell>
                  <TableCell className="text-right">{d.vehicles}</TableCell>
                  <TableCell className="text-right">{fmtCurrency(d.revenue)}</TableCell>
                  <TableCell className="text-right text-green-700 dark:text-green-400">
                    {fmtCurrency(d.collected)}
                  </TableCell>
                  <TableCell className="text-right text-amber-700 dark:text-amber-400">
                    {fmtCurrency(d.pending)}
                  </TableCell>
                  <TableCell className="text-right">{fmtCurrency(d.mercadoPago)}</TableCell>
                  <TableCell className="text-right">{fmtCurrency(d.transferencia)}</TableCell>
                  <TableCell className="text-right">{fmtCurrency(d.pagarDespues)}</TableCell>
                  <TableCell className="text-right">{fmtCurrency(d.avgTicket)}</TableCell>
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
        )}
      </CardContent>
    </Card>
  );
}
