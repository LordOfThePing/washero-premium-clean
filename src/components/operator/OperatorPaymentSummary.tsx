import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { paymentInstruction, type OperatorBooking } from "@/lib/operator";
import { paymentStatusLabels } from "@/lib/booking-badges";
import { cn } from "@/lib/utils";

type Props = {
  booking: OperatorBooking;
};

function formatPrice(price: number) {
  return `$${Math.round(price).toLocaleString("es-AR")}`;
}

export function OperatorPaymentSummary({ booking }: Props) {
  const pay = paymentInstruction(booking);
  const collectPending =
    booking.payment_method === "Pagar después" && booking.payment_status !== "paid";

  return (
    <Card className={cn(collectPending && "border-amber-300/50 bg-amber-50/30 dark:bg-amber-950/20")}>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Pago</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p>
          <span className="text-muted-foreground">Método: </span>
          {booking.payment_method}
        </p>
        <p>
          <span className="text-muted-foreground">Estado: </span>
          {paymentStatusLabels[booking.payment_status] ?? booking.payment_status}
        </p>
        <p className="text-base font-semibold">{formatPrice(booking.price)}</p>
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
        {collectPending ? (
          <p className="rounded-md border border-amber-300/60 bg-amber-50 p-2 text-xs font-medium text-amber-950 dark:bg-amber-950/40 dark:text-amber-100">
            Cobro pendiente al finalizar el lavado.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
