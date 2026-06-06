import { Link } from "@tanstack/react-router";
import { MapPin } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { OperatorNavActions } from "@/components/operator/OperatorNavActions";
import {
  customerFirstName,
  formatOpTime,
  paymentInstruction,
  type OperatorBooking,
} from "@/lib/operator";
import { BookingStatusBadge, PaymentStatusBadge } from "@/lib/booking-badges";

type Props = {
  booking: OperatorBooking;
};

export function OperatorNextWashHero({ booking }: Props) {
  const pay = paymentInstruction(booking);
  const addr = booking.formatted_address || booking.address;

  return (
    <Card className="overflow-hidden border-primary/40 bg-primary/5 shadow-sm">
      <CardContent className="space-y-3 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-primary">Próximo lavado</p>

        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-2xl font-semibold tabular-nums">{formatOpTime(booking.scheduled_time)}</p>
            <p className="text-lg font-medium">{customerFirstName(booking.customer_name)}</p>
            <p className="text-sm text-muted-foreground">
              {booking.service_name} · {booking.vehicle_type}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <BookingStatusBadge value={booking.booking_status} />
            <PaymentStatusBadge value={booking.payment_status} />
          </div>
        </div>

        <p className="flex items-start gap-1.5 text-sm">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <span>
            {addr}
            {booking.neighborhood ? `, ${booking.neighborhood}` : ""}
          </span>
        </p>

        {booking.coverage_zone_name ? (
          <p className="text-xs text-muted-foreground">Zona: {booking.coverage_zone_name}</p>
        ) : null}

        <Badge
          variant="outline"
          className={
            pay.tone === "paid"
              ? "border-green-300 bg-green-50 text-green-900 dark:bg-green-950/30"
              : pay.tone === "collect"
                ? "border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-950/30"
                : ""
          }
        >
          {pay.label}
        </Badge>

        <Button asChild className="h-11 w-full text-base">
          <Link
            to="/operator/reserva/$bookingId"
            params={{ bookingId: booking.id }}
            search={{ from: "hoy" }}
          >
            Ver detalle
          </Link>
        </Button>

        <OperatorNavActions booking={booking} showDetail={false} />
      </CardContent>
    </Card>
  );
}
