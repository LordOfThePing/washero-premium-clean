import { useMemo, useState } from "react";
import { CalendarOff, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  BookingSourceBadge,
  BookingStatusBadge,
  PaymentStatusBadge,
  formatPrice,
} from "@/lib/booking-badges";
import type { FinanceBooking } from "@/lib/finance/types";
import { fmtDate, normalizePaymentMethod, zoneLabel } from "@/lib/finance/utils";
import { paymentReceiptStatusLabels } from "@/lib/payment-receipts";

type Props = {
  bookings: FinanceBooking[];
  receiptStatusByBooking: Map<string, string>;
};

function receiptBadge(status: string | undefined) {
  if (!status) return null;
  const label =
    paymentReceiptStatusLabels[status as keyof typeof paymentReceiptStatusLabels] ?? status;
  const className =
    status === "approved"
      ? "bg-green-100 text-green-900 dark:bg-green-500/15 dark:text-green-300"
      : status === "pending_review"
        ? "bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-300"
        : status === "rejected"
          ? "bg-red-100 text-red-900 dark:bg-red-500/15 dark:text-red-300"
          : "";
  return (
    <Badge variant="secondary" className={`text-[10px] ${className}`}>
      {label}
    </Badge>
  );
}

export function BookingsDetailTable({ bookings, receiptStatusByBooking }: Props) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = bookings
      .filter((b) => b.booking_status !== "cancelled")
      .sort((a, b) =>
        a.scheduled_date === b.scheduled_date
          ? a.scheduled_time.localeCompare(b.scheduled_time)
          : a.scheduled_date.localeCompare(b.scheduled_date),
      );
    if (!q) return rows;
    return rows.filter((b) =>
      [
        b.customer_name,
        b.customer_phone,
        b.neighborhood,
        b.private_neighborhood_name,
        b.service_name,
      ]
        .filter(Boolean)
        .some((v) => v.toLowerCase().includes(q)),
    );
  }, [bookings, search]);

  const needsAction = useMemo(
    () =>
      filtered.filter(
        (b) =>
          b.payment_status === "pending" ||
          (normalizePaymentMethod(b.payment_method) === "transfer" &&
            receiptStatusByBooking.get(b.id) !== "approved"),
      ).length,
    [filtered, receiptStatusByBooking],
  );

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle className="text-base">Reservas del período</CardTitle>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Listado para revisar cobros, transferencias y comprobantes.
            {filtered.length > 0 && needsAction > 0 && (
              <span className="ml-1 font-medium text-amber-700 dark:text-amber-400">
                {needsAction} requieren acción.
              </span>
            )}
          </p>
        </div>
        <div className="relative w-full sm:max-w-xs">
          <Label className="sr-only">Buscar reserva</Label>
          <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Buscar cliente, teléfono o barrio…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </CardHeader>
      <CardContent>
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-md border border-dashed px-4 py-10 text-center">
            <CalendarOff className="h-8 w-8 text-muted-foreground/60" />
            <p className="text-sm font-medium">No hay reservas para mostrar</p>
            <p className="max-w-sm text-xs text-muted-foreground">
              {search
                ? "No encontramos resultados con ese criterio. Probá otro nombre o teléfono."
                : "No hay reservas activas en el período seleccionado."}
            </p>
          </div>
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Hora</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Teléfono</TableHead>
                    <TableHead>Zona</TableHead>
                    <TableHead>Servicio</TableHead>
                    <TableHead className="text-right">Veh.</TableHead>
                    <TableHead className="text-right">Precio</TableHead>
                    <TableHead>Método</TableHead>
                    <TableHead>Pago</TableHead>
                    <TableHead>Reserva</TableHead>
                    <TableHead>Origen</TableHead>
                    <TableHead>Comprobante</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((b) => (
                    <TableRow key={b.id}>
                      <TableCell className="whitespace-nowrap">
                        {fmtDate(b.scheduled_date)}
                      </TableCell>
                      <TableCell>{b.scheduled_time?.slice(0, 5)}</TableCell>
                      <TableCell className="max-w-[120px] truncate">{b.customer_name}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs">
                        {b.customer_phone}
                      </TableCell>
                      <TableCell className="max-w-[120px] truncate">
                        {zoneLabel(b.neighborhood, b.private_neighborhood_name)}
                      </TableCell>
                      <TableCell className="max-w-[120px] truncate">{b.service_name}</TableCell>
                      <TableCell className="text-right tabular-nums">{b.vehicle_count}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatPrice(b.price)}
                      </TableCell>
                      <TableCell className="text-xs">{b.payment_method}</TableCell>
                      <TableCell>
                        <PaymentStatusBadge value={b.payment_status} />
                      </TableCell>
                      <TableCell>
                        <BookingStatusBadge value={b.booking_status} />
                      </TableCell>
                      <TableCell>
                        <BookingSourceBadge value={b.booking_source} />
                      </TableCell>
                      <TableCell>{receiptBadge(receiptStatusByBooking.get(b.id))}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="space-y-3 md:hidden">
              {filtered.map((b) => (
                <div key={b.id} className="rounded-lg border p-3 text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{b.customer_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {fmtDate(b.scheduled_date)} · {b.scheduled_time?.slice(0, 5)}
                      </p>
                    </div>
                    <p className="shrink-0 font-semibold tabular-nums">{formatPrice(b.price)}</p>
                  </div>
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {zoneLabel(b.neighborhood, b.private_neighborhood_name)} · {b.service_name} ·{" "}
                    {b.vehicle_count} veh.
                  </p>
                  <p className="text-xs tabular-nums">{b.customer_phone}</p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    <Badge variant="outline" className="text-[10px]">
                      {b.payment_method}
                    </Badge>
                    <PaymentStatusBadge value={b.payment_status} />
                    <BookingStatusBadge value={b.booking_status} />
                    {receiptBadge(receiptStatusByBooking.get(b.id))}
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
