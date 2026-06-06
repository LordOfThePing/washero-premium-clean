import { MapPin } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { OperatorNavActions } from "@/components/operator/OperatorNavActions";
import {
  type OperatorBooking,
  customerFirstName,
  formatOpTime,
  paymentInstruction,
  statusLabel,
} from "@/lib/operator";
import { BookingStatusBadge, PaymentStatusBadge } from "@/lib/booking-badges";
import { cn } from "@/lib/utils";

type Variant = "default" | "highlight" | "compact" | "done";

type Props = {
  booking: OperatorBooking;
  variant?: Variant;
  detailFrom?: string;
};

export function OperatorBookingCard({ booking, variant = "default", detailFrom }: Props) {
  const pay = paymentInstruction(booking);
  const addr = booking.formatted_address || booking.address;
  const isCompact = variant === "compact";
  const padding = isCompact ? "p-3" : "p-4";
  const spacing = isCompact ? "space-y-2" : "space-y-3";

  return (
    <Card
      className={cn(
        "overflow-hidden",
        variant === "highlight" && "border-primary/40 bg-primary/5",
        variant === "done" && "opacity-75",
      )}
    >
      <CardContent className={cn(spacing, padding)}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <p
              className={cn(
                "font-semibold tabular-nums",
                isCompact ? "text-base" : "text-lg",
              )}
            >
              {formatOpTime(booking.scheduled_time)}
            </p>
            <p className={cn("font-medium", isCompact && "text-sm")}>
              {customerFirstName(booking.customer_name)}
            </p>
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

        <OperatorNavActions
          booking={booking}
          size={isCompact ? "sm" : "default"}
          detailFrom={detailFrom}
        />
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
