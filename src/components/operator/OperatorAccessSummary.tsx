import { MapPin, ShieldAlert } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { OperatorNavActions } from "@/components/operator/OperatorNavActions";
import {
  isPrivateNeighborhoodBooking,
  operatorAccessLines,
  type OperatorBooking,
} from "@/lib/operator";
import { cn } from "@/lib/utils";

type Props = {
  booking: OperatorBooking;
  detailFrom?: string;
};

export function OperatorAccessSummary({ booking, detailFrom }: Props) {
  const lines = operatorAccessLines(booking);
  const isPrivate = isPrivateNeighborhoodBooking(booking);
  const hasNotes = !!(booking.notes?.trim() || booking.operator_notes?.trim());

  return (
    <Card
      className={cn(
        isPrivate && "border-amber-400/60 bg-amber-50/40 dark:bg-amber-950/25",
      )}
    >
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          {isPrivate ? (
            <ShieldAlert className="h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" />
          ) : (
            <MapPin className="h-4 w-4 shrink-0" />
          )}
          Ubicación y acceso
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {lines.length === 0 ? (
          <p className="text-muted-foreground">Sin dirección registrada.</p>
        ) : null}
        {lines.map((line) => (
          <div
            key={line.label}
            className={cn(
              line.highlight &&
                "rounded-md border border-amber-300/70 bg-amber-100/60 p-2 dark:border-amber-700/50 dark:bg-amber-950/40",
            )}
          >
            <p className="text-xs font-medium text-muted-foreground">{line.label}</p>
            <p className={cn(line.highlight && "font-medium")}>{line.value}</p>
          </div>
        ))}

        <OperatorNavActions booking={booking} showDetail={false} detailFrom={detailFrom} />

        {hasNotes ? (
          <div className="space-y-2 border-t pt-3 whitespace-pre-wrap">
            {booking.notes?.trim() ? (
              <div>
                <p className="text-xs font-medium text-muted-foreground">Notas del cliente</p>
                <p>{booking.notes}</p>
              </div>
            ) : null}
            {booking.operator_notes?.trim() ? (
              <div>
                <p className="text-xs font-medium text-muted-foreground">Notas del operador</p>
                <p className="text-muted-foreground">{booking.operator_notes}</p>
              </div>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
