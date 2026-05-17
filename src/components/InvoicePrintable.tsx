import { formatPrice } from "@/lib/booking-badges";
import { fmtInvoiceDate, parseLineItems, type Invoice } from "@/lib/invoices";
import { Logo } from "@/components/brand/Logo";

function fmtDate(d: string | null) {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
}

function fmtTime(t: string | null) {
  return t ? t.slice(0, 5) : "—";
}

export function InvoicePrintable({
  invoice,
  className = "",
}: {
  invoice: Invoice;
  className?: string;
}) {
  const lines = parseLineItems(invoice.line_items);

  return (
    <article
      className={`mx-auto max-w-2xl rounded-lg border bg-card p-6 text-sm shadow-sm print:max-w-none print:border-0 print:shadow-none ${className}`}
    >
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4 border-b pb-4">
        <div>
          <Logo className="mb-2" />
          <p className="text-lg font-semibold">Comprobante interno</p>
          <p className="text-xs text-muted-foreground">
            Comprobante interno de Washero. No válido como factura fiscal.
          </p>
        </div>
        <InvoiceMeta invoice={invoice} />
      </header>

      <section className="mb-5 grid gap-4 sm:grid-cols-2">
        <div>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Cliente
          </h2>
          <p className="font-medium">{invoice.customer_name ?? "—"}</p>
          <p className="text-muted-foreground">{invoice.customer_phone ?? "—"}</p>
          {invoice.customer_email && (
            <p className="text-muted-foreground">{invoice.customer_email}</p>
          )}
          {invoice.customer_address && (
            <p className="mt-1 text-muted-foreground">{invoice.customer_address}</p>
          )}
        </div>
        <div>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Reserva
          </h2>
          <p>
            <span className="text-muted-foreground">Servicio:</span> {invoice.service_name ?? "—"}
          </p>
          <p>
            <span className="text-muted-foreground">Vehículo:</span> {invoice.vehicle_type ?? "—"}
          </p>
          <p>
            <span className="text-muted-foreground">Fecha:</span> {fmtDate(invoice.scheduled_date)}{" "}
            · {fmtTime(invoice.scheduled_time)}
          </p>
          <p>
            <span className="text-muted-foreground">Pago:</span> {invoice.payment_method ?? "—"} (
            {invoice.payment_status ?? "—"})
          </p>
        </div>
      </section>

      <section className="mb-5">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Detalle
        </h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="pb-2 font-medium">Concepto</th>
              <th className="pb-2 text-right font-medium">Importe</th>
            </tr>
          </thead>
          <tbody>
            {lines.length > 0 ? (
              lines.map((line, i) => (
                <tr key={i} className="border-b border-border/40">
                  <td className="py-2">{line.label}</td>
                  <td className="py-2 text-right tabular-nums">
                    {line.amount > 0 ? formatPrice(line.amount) : "—"}
                  </td>
                </tr>
              ))
            ) : (
              <>
                <tr className="border-b border-border/40">
                  <td className="py-2">{invoice.service_name ?? "Servicio"}</td>
                  <td className="py-2 text-right tabular-nums">
                    {formatPrice(invoice.subtotal ?? 0)}
                  </td>
                </tr>
                {(invoice.vehicle_surcharge ?? 0) > 0 && (
                  <tr className="border-b border-border/40">
                    <td className="py-2">
                      Recargo vehículo ({invoice.vehicle_type ?? ""})
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {formatPrice(invoice.vehicle_surcharge ?? 0)}
                    </td>
                  </tr>
                )}
                {(invoice.extras_total ?? 0) > 0 && (
                  <tr className="border-b border-border/40">
                    <td className="py-2">Extras</td>
                    <td className="py-2 text-right tabular-nums">
                      {formatPrice(invoice.extras_total ?? 0)}
                    </td>
                  </tr>
                )}
              </>
            )}
          </tbody>
        </table>
      </section>

      <footer className="space-y-1 border-t pt-4 text-sm">
        {(invoice.subtotal ?? 0) > 0 && lines.length > 0 && (
          <div className="flex justify-between text-muted-foreground">
            <span>Subtotal</span>
            <span className="tabular-nums">{formatPrice(invoice.subtotal ?? 0)}</span>
          </div>
        )}
        {(invoice.vehicle_surcharge ?? 0) > 0 && lines.length > 0 && (
          <div className="flex justify-between text-muted-foreground">
            <span>Recargo vehículo</span>
            <span className="tabular-nums">{formatPrice(invoice.vehicle_surcharge ?? 0)}</span>
          </div>
        )}
        {(invoice.extras_total ?? 0) > 0 && lines.length > 0 && (
          <div className="flex justify-between text-muted-foreground">
            <span>Extras</span>
            <span className="tabular-nums">{formatPrice(invoice.extras_total ?? 0)}</span>
          </div>
        )}
        <div className="flex justify-between text-base font-semibold">
          <span>Total</span>
          <span className="tabular-nums">{formatPrice(invoice.total ?? 0)}</span>
        </div>
        {invoice.notes && (
          <p className="pt-2 text-xs text-muted-foreground">
            <span className="font-medium">Notas:</span> {invoice.notes}
          </p>
        )}
      </footer>
    </article>
  );
}

function InvoiceMeta({ invoice }: { invoice: Invoice }) {
  return (
    <div className="text-right text-sm">
      <p className="font-mono text-base font-semibold">{invoice.invoice_number ?? "—"}</p>
      <p className="text-muted-foreground">Emitida: {fmtInvoiceDate(invoice.issued_at)}</p>
    </div>
  );
}
