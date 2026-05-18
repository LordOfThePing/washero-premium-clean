import { Link } from "@tanstack/react-router";
import { MapPin, MessageCircle, Navigation } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  type OperatorBooking,
  customerFirstName,
  formatOpTime,
  mapsUrl,
  paymentInstruction,
  statusLabel,
  whatsappClientUrl,
} from "@/lib/operator";
import { BookingStatusBadge, PaymentStatusBadge } from "@/lib/booking-badges";

export function OperatorBookingCard({ booking }: { booking: OperatorBooking }) {
  const pay = paymentInstruction(booking);
  const addr = booking.formatted_address || booking.address;

  return (
    <Card className="overflow-hidden">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-lg font-semibold tabular-nums">{formatOpTime(booking.scheduled_time)}</p>
            <p className="font-medium">{customerFirstName(booking.customer_name)}</p>
            <p className="text-sm text-muted-foreground">{booking.service_name} · {booking.vehicle_type}</p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <BookingStatusBadge value={booking.booking_status} />
            <PaymentStatusBadge value={booking.payment_status} />
          </div>
        </div>

        <p className="flex items-start gap-1.5 text-sm">
          <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
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

        <div className="grid grid-cols-2 gap-2">
          <Button asChild variant="outline" size="sm" className="h-10">
            <Link to="/operator/reserva/$bookingId" params={{ bookingId: booking.id }}>
              Ver detalle
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm" className="h-10">
            <a href={whatsappClientUrl(booking.customer_phone)} target="_blank" rel="noreferrer">
              <MessageCircle className="mr-1 h-4 w-4" /> WhatsApp
            </a>
          </Button>
          <Button asChild variant="secondary" size="sm" className="col-span-2 h-10">
            <a href={mapsUrl(booking)} target="_blank" rel="noreferrer">
              <Navigation className="mr-1 h-4 w-4" /> Cómo llegar
            </a>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function OperatorStatusTimeline({ status }: { status: string }) {
  const steps = [
    { key: "confirmed", label: "Confirmada" },
    { key: "in_progress", label: "En proceso" },
    { key: "completed", label: "Completada" },
  ];
  const order = ["pending", "needs_review", "confirmed", "in_progress", "completed", "cancelled"];
  const idx = order.indexOf(status);

  return (
    <div className="flex flex-wrap gap-2 text-xs">
      {steps.map((s) => {
        const stepIdx = order.indexOf(s.key);
        const done = idx >= stepIdx && status !== "cancelled";
        return (
          <Badge key={s.key} variant={done ? "default" : "outline"}>
            {s.label}
          </Badge>
        );
      })}
      {status === "needs_review" && <Badge variant="secondary">Revisar</Badge>}
      {status === "cancelled" && <Badge variant="destructive">Cancelada</Badge>}
      {!["confirmed", "in_progress", "completed", "cancelled", "needs_review"].includes(status) && (
        <Badge variant="outline">{statusLabel(status)}</Badge>
      )}
    </div>
  );
}
