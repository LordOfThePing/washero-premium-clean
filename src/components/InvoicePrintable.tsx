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

function paymentStatusLabel(status: string | null) {
  if (!status) return "—";
  if (status === "paid") return "Pagado";
  if (status === "pending") return "Pendiente";
  if (status === "failed") return "Fallido";
  if (status === "refunded") return "Reembolsado";
  if (status === "cancelled") return "Cancelado";
  return status;
}

function invoiceStatusLabel(status: string | null) {
  if (!status) return "Emitido";
  if (status === "issued") return "Emitido";
  if (status === "void") return "Anulado";
  if (status === "cancelled") return "Cancelado";
  if (status === "pending") return "Pendiente";
  return status;
}

function statusTone(status: string | null) {
  if (status === "paid" || status === "issued") return "bg-emerald-100 text-emerald-700";
  if (status === "pending") return "bg-amber-100 text-amber-700";
  return "bg-slate-200 text-slate-700";
}

function extractEstimatedDuration(notes: string | null) {
  if (!notes) return null;
  const match = notes.match(/duraci[oó]n estimada:\s*(\d+)\s*min/i);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function InvoicePrintable({
  invoice,
  className = "",
}: {
  invoice: Invoice;
  className?: string;
}) {
  const lines = parseLineItems(invoice.line_items);
  const chargedLines = lines.filter((line) => line.amount > 0);
  const estimatedDuration = extractEstimatedDuration(invoice.notes);

  return (
    <article
      className={`mx-auto max-w-2xl rounded-2xl border border-orange-100 bg-white p-6 text-sm text-slate-900 shadow-sm print:max-w-none print:border-0 print:shadow-none ${className}`}
    >
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-4">
        <div className="space-y-2">
          <Logo />
          <div className="h-1 w-28 rounded-full bg-primary" />
          <div>
            <p className="text-lg font-semibold">Comprobante interno</p>
            <p className="text-xs text-slate-500">No válido como factura fiscal.</p>
          </div>
        </div>
        <div className="text-right text-sm">
          <p className="text-xs uppercase tracking-wide text-slate-500">Comprobante</p>
          <p className="font-mono text-base font-semibold">{invoice.invoice_number ?? "—"}</p>
          <p className="text-slate-600">Emitida: {fmtInvoiceDate(invoice.issued_at)}</p>
          <div className="mt-2 flex justify-end gap-2">
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${statusTone(invoice.invoice_status)}`}>
              {invoiceStatusLabel(invoice.invoice_status)}
            </span>
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${statusTone(invoice.payment_status)}`}>
              {paymentStatusLabel(invoice.payment_status)}
            </span>
          </div>
        </div>
      </header>

      <section className="mb-5 grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-slate-200 p-3">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Cliente
          </h2>
          <p className="font-medium">{invoice.customer_name ?? "—"}</p>
          <p className="text-slate-600">{invoice.customer_phone ?? "—"}</p>
          {invoice.customer_email && (
            <p className="text-slate-600">{invoice.customer_email}</p>
          )}
          {invoice.customer_address && (
            <p className="mt-1 text-slate-600">{invoice.customer_address}</p>
          )}
        </div>
        <div className="rounded-lg border border-slate-200 p-3">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Reserva
          </h2>
          <p><span className="text-slate-500">Servicio:</span> {invoice.service_name ?? "—"}</p>
          <p><span className="text-slate-500">Vehículo:</span> {invoice.vehicle_type ?? "—"}</p>
          <p>
            <span className="text-slate-500">Fecha:</span> {fmtDate(invoice.scheduled_date)}{" "}
            · {fmtTime(invoice.scheduled_time)}
          </p>
          {estimatedDuration ? (
            <p><span className="text-slate-500">Duración estimada:</span> {estimatedDuration} min</p>
          ) : null}
          <p><span className="text-slate-500">Método de pago:</span> {invoice.payment_method ?? "—"}</p>
          <p><span className="text-slate-500">Estado de pago:</span> {paymentStatusLabel(invoice.payment_status)}</p>
        </div>
      </section>

      <section className="mb-5">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Detalle
        </h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
              <th className="pb-2 font-medium">Concepto</th>
              <th className="pb-2 text-right font-medium">Importe</th>
            </tr>
          </thead>
          <tbody>
            {chargedLines.length > 0 ? (
              chargedLines.map((line, i) => (
                <tr key={i} className="border-b border-slate-100">
                  <td className="py-2">{line.label}</td>
                  <td className="py-2 text-right tabular-nums">
                    {formatPrice(line.amount)}
                  </td>
                </tr>
              ))
            ) : (
              <>
                <tr className="border-b border-slate-100">
                  <td className="py-2">{invoice.service_name ?? "Servicio"}</td>
                  <td className="py-2 text-right tabular-nums">
                    {formatPrice(invoice.subtotal ?? 0)}
                  </td>
                </tr>
                {(invoice.vehicle_surcharge ?? 0) > 0 && (
                  <tr className="border-b border-slate-100">
                    <td className="py-2">
                      Recargo vehículo ({invoice.vehicle_type ?? ""})
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {formatPrice(invoice.vehicle_surcharge ?? 0)}
                    </td>
                  </tr>
                )}
                {(invoice.extras_total ?? 0) > 0 && (
                  <tr className="border-b border-slate-100">
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

      <footer className="space-y-1 border-t border-slate-200 pt-4 text-sm">
        {(invoice.subtotal ?? 0) > 0 && chargedLines.length > 0 && (
          <div className="flex justify-between text-slate-600">
            <span>Subtotal</span>
            <span className="tabular-nums">{formatPrice(invoice.subtotal ?? 0)}</span>
          </div>
        )}
        {(invoice.extras_total ?? 0) > 0 && chargedLines.length > 0 && (
          <div className="flex justify-between text-slate-600">
            <span>Extras</span>
            <span className="tabular-nums">{formatPrice(invoice.extras_total ?? 0)}</span>
          </div>
        )}
        <div className="flex justify-between text-base font-semibold">
          <span>Total</span>
          <span className="tabular-nums">{formatPrice(invoice.total ?? 0)}</span>
        </div>
        <div className="pt-3 text-xs text-slate-500">
          <p>Gracias por elegir Washero.</p>
          <p>Este comprobante interno no es válido como factura fiscal.</p>
        </div>
      </footer>
    </article>
  );
}
