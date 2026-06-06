import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatOpDate, formatOpTime, operatorDetailBackRoute, type OperatorBooking } from "@/lib/operator";
import { BookingStatusBadge, PaymentStatusBadge } from "@/lib/booking-badges";

type Props = {
  booking: OperatorBooking;
  from?: string;
};

export function OperatorDetailHeader({ booking, from }: Props) {
  const backTo = operatorDetailBackRoute(from);

  return (
    <div className="space-y-3">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link to={backTo}>
          <ArrowLeft className="mr-1 h-4 w-4" /> Volver
        </Link>
      </Button>

      <div>
        <h1 className="text-xl font-semibold">{booking.customer_name}</h1>
        <p className="text-sm text-muted-foreground">
          {formatOpDate(booking.scheduled_date)} · {formatOpTime(booking.scheduled_time)}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <BookingStatusBadge value={booking.booking_status} />
          <PaymentStatusBadge value={booking.payment_status} />
        </div>
      </div>
    </div>
  );
}
