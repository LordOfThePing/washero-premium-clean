import { useMemo, useState } from "react";
import { Search } from "lucide-react";
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
import { fmtDate, zoneLabel } from "@/lib/finance/utils";
import { paymentReceiptStatusLabels } from "@/lib/payment-receipts";

type Props = {
  bookings: FinanceBooking[];
  receiptStatusByBooking: Map<string, string>;
};

function receiptBadge(status: string | undefined) {
  if (!status) return null;
  const label =
    paymentReceiptStatusLabels[status as keyof typeof paymentReceiptStatusLabels] ?? status;
  const variant =
    status === "approved" ? "default" : status === "pending_review" ? "secondary" : "outline";
  return (
    <Badge variant={variant} className="text-[10px]">
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

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle className="text-base">Detalle de reservas</CardTitle>
        <div className="relative w-full sm:max-w-xs">
          <Label className="sr-only">Buscar</Label>
          <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Cliente, teléfono, barrio…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </CardHeader>
      <CardContent>
        {filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground">No hay reservas en el período.</p>
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
                    <TableHead>Comp.</TableHead>
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
                      <TableCell className="text-right">{b.vehicle_count}</TableCell>
                      <TableCell className="text-right">{formatPrice(b.price)}</TableCell>
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
                    <div>
                      <p className="font-medium">{b.customer_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {fmtDate(b.scheduled_date)} · {b.scheduled_time?.slice(0, 5)}
                      </p>
                    </div>
                    <p className="font-semibold">{formatPrice(b.price)}</p>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {zoneLabel(b.neighborhood, b.private_neighborhood_name)} · {b.service_name} ·{" "}
                    {b.vehicle_count} veh.
                  </p>
                  <p className="text-xs">{b.customer_phone}</p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    <Badge variant="outline">{b.payment_method}</Badge>
                    <PaymentStatusBadge value={b.payment_status} />
                    <BookingStatusBadge value={b.booking_status} />
                    <BookingSourceBadge value={b.booking_source} />
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
