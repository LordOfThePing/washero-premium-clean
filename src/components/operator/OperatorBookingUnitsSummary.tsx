import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  formatExtrasForDisplay,
  formatOperatorPrice,
  formatOperatorVehicleLabel,
  operatorUnitLabel,
  type OperatorBooking,
  type OperatorBookingUnit,
} from "@/lib/operator";

type Props = {
  booking: OperatorBooking;
  units: OperatorBookingUnit[];
};

function UnitCard({ unit }: { unit: OperatorBookingUnit }) {
  const extras = formatExtrasForDisplay(unit.selected_extras, unit.price_breakdown);

  return (
    <div className="rounded-lg border bg-muted/20 p-3 space-y-2 text-sm">
      <div className="flex items-center justify-between gap-2">
        <p className="font-semibold">{operatorUnitLabel(unit.unit_index)}</p>
        {unit.discount_amount > 0 ? (
          <Badge variant="secondary" className="text-[10px]">
            Descuento aplicado
          </Badge>
        ) : null}
      </div>
      <p>
        <span className="text-muted-foreground">Servicio: </span>
        {unit.service_name}
      </p>
      <p>
        <span className="text-muted-foreground">Vehículo: </span>
        {formatOperatorVehicleLabel(unit)}
      </p>
      {unit.duration_minutes > 0 ? (
        <p>
          <span className="text-muted-foreground">Duración estimada: </span>
          {unit.duration_minutes} min
        </p>
      ) : null}
      {extras.hasExtras ? (
        <p>
          <span className="text-muted-foreground">Extras: </span>
          {extras.text}
        </p>
      ) : null}
      {unit.discount_amount > 0 ? (
        <p className="text-green-700 dark:text-green-400">
          Descuento: −{formatOperatorPrice(unit.discount_amount)}
        </p>
      ) : null}
      <p className="font-medium">{formatOperatorPrice(unit.total_price)}</p>
    </div>
  );
}

function BookingFallback({ booking }: { booking: OperatorBooking }) {
  const extras = formatExtrasForDisplay(booking.selected_extras, booking.price_breakdown);

  return (
    <div className="space-y-2 text-sm">
      <p className="text-xs text-muted-foreground">Detalle cargado desde la reserva principal.</p>
      <p>
        <span className="text-muted-foreground">Servicio: </span>
        {booking.service_name}
      </p>
      <p>
        <span className="text-muted-foreground">Vehículo: </span>
        {formatOperatorVehicleLabel(booking)}
      </p>
      {booking.duration_minutes > 0 ? (
        <p>
          <span className="text-muted-foreground">Duración estimada: </span>
          {booking.duration_minutes} min
        </p>
      ) : null}
      {extras.hasExtras ? (
        <p>
          <span className="text-muted-foreground">Extras: </span>
          {extras.text}
        </p>
      ) : null}
      {booking.assigned_vehicle_label ? (
        <p className="text-muted-foreground">
          Vehículo operativo asignado: {booking.assigned_vehicle_label}
        </p>
      ) : null}
    </div>
  );
}

export function OperatorBookingUnitsSummary({ booking, units }: Props) {
  const vehicleCount = booking.vehicle_count > 0 ? booking.vehicle_count : units.length || 1;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">
          Servicio{vehicleCount > 1 ? ` · ${vehicleCount} autos` : ""}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {units.length > 0 ? (
          units.map((unit) => <UnitCard key={unit.id} unit={unit} />)
        ) : (
          <BookingFallback booking={booking} />
        )}
      </CardContent>
    </Card>
  );
}
