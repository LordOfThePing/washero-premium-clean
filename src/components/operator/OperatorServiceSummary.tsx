import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { type OperatorBooking } from "@/lib/operator";

type Props = {
  booking: OperatorBooking;
};

export function OperatorServiceSummary({ booking }: Props) {
  const extras = Array.isArray(booking.selected_extras)
    ? (booking.selected_extras as string[]).join(", ")
    : "";

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Servicio</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p>
          {booking.service_name} · {booking.vehicle_type}
        </p>
        {extras ? <p className="text-muted-foreground">Extras: {extras}</p> : null}
        {booking.duration_minutes > 0 ? (
          <p className="text-muted-foreground">Duración estimada: {booking.duration_minutes} min</p>
        ) : null}
        {booking.assigned_vehicle_label ? (
          <p className="text-muted-foreground">Vehículo operativo: {booking.assigned_vehicle_label}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
