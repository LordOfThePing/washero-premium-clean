import { Link } from "@tanstack/react-router";
import { Navigation } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { mapsUrl, wazeUrl, type OperatorBooking } from "@/lib/operator";

type Props = {
  booking: OperatorBooking;
  size?: "sm" | "default";
  showDetail?: boolean;
  /** Passed as `?from=` when linking to the booking detail page. */
  detailFrom?: string;
};

export function OperatorNavActions({
  booking,
  size = "default",
  showDetail = true,
  detailFrom,
}: Props) {
  const btnClass = size === "sm" ? "h-9 text-xs" : "h-10";

  return (
    <div className={cn("grid gap-2", showDetail ? "grid-cols-3" : "grid-cols-2")}>
      <Button asChild variant="secondary" size="sm" className={btnClass}>
        <a href={mapsUrl(booking)} target="_blank" rel="noreferrer">
          <Navigation className="mr-1 h-3.5 w-3.5 shrink-0" />
          Maps
        </a>
      </Button>
      <Button asChild variant="outline" size="sm" className={btnClass}>
        <a href={wazeUrl(booking)} target="_blank" rel="noreferrer">
          Waze
        </a>
      </Button>
      {showDetail ? (
        <Button asChild variant="outline" size="sm" className={btnClass}>
          <Link
            to="/operator/reserva/$bookingId"
            params={{ bookingId: booking.id }}
            search={detailFrom ? { from: detailFrom } : undefined}
          >
            Detalle
          </Link>
        </Button>
      ) : null}
    </div>
  );
}
