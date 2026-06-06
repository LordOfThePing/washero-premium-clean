import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  formatOperatorPrice,
  paymentInstruction,
  type OperatorBooking,
  type OperatorBookingUnit,
} from "@/lib/operator";
import { paymentStatusLabels } from "@/lib/booking-badges";
import { cn } from "@/lib/utils";

type Props = {
  booking: OperatorBooking;
  units?: OperatorBookingUnit[];
};

function PriceRow({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className={cn("flex justify-between gap-3", emphasis && "font-semibold")}>
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  );
}

export function OperatorPriceSummary({ booking, units = [] }: Props) {
  const pay = paymentInstruction(booking);
  const collectPending =
    booking.payment_method === "Pagar después" && booking.payment_status !== "paid";

  const extrasFromUnits = units.reduce((sum, u) => {
    const n = Number(u.extras_total);
    return sum + (Number.isFinite(n) ? n : 0);
  }, 0);
  const bookingExtras = Number(booking.extras_total);
  const extrasTotal =
    units.length > 0 ? extrasFromUnits : Number.isFinite(bookingExtras) ? bookingExtras : 0;
  const discountTotal = Number.isFinite(Number(booking.discount_total))
    ? Number(booking.discount_total)
    : 0;
  const price = Number(booking.price);
  const subtotalBefore = Number(booking.subtotal_before_discounts);
  const subtotal = Number.isFinite(subtotalBefore)
    ? subtotalBefore
    : discountTotal > 0 && Number.isFinite(price)
      ? price + discountTotal
      : null;

  return (
    <Card className={cn(collectPending && "border-amber-300/50 bg-amber-50/30 dark:bg-amber-950/20")}>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Pago</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {subtotal != null && subtotal !== booking.price ? (
          <PriceRow label="Subtotal" value={formatOperatorPrice(subtotal)} />
        ) : null}
        {extrasTotal > 0 ? (
          <PriceRow label="Extras" value={formatOperatorPrice(extrasTotal)} />
        ) : null}
        {discountTotal > 0 ? (
          <PriceRow label="Descuentos" value={`−${formatOperatorPrice(discountTotal)}`} />
        ) : null}
        <PriceRow label="Total" value={formatOperatorPrice(booking.price)} emphasis />

        <div className="space-y-1 border-t pt-2">
          <p>
            <span className="text-muted-foreground">Método: </span>
            {booking.payment_method}
          </p>
          <p>
            <span className="text-muted-foreground">Estado: </span>
            {paymentStatusLabels[booking.payment_status] ?? booking.payment_status}
          </p>
        </div>

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
            Cobrar al finalizar el lavado.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
