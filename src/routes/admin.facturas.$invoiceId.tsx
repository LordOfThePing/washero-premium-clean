import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ClipboardList, Loader2, Printer } from "lucide-react";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { InvoicePrintable } from "@/components/InvoicePrintable";
import { fetchInvoiceById } from "@/lib/invoices";

const searchSchema = z.object({
  print: z.enum(["1"]).optional(),
});

export const Route = createFileRoute("/admin/facturas/$invoiceId")({
  validateSearch: searchSchema,
  component: InvoiceDetailPage,
});

function InvoiceDetailPage() {
  const { invoiceId } = Route.useParams();
  const search = Route.useSearch();

  const invoice = useQuery({
    queryKey: ["facturas", invoiceId],
    queryFn: () => fetchInvoiceById(invoiceId),
  });

  useEffect(() => {
    if (search.print === "1" && invoice.data) {
      const t = window.setTimeout(() => window.print(), 400);
      return () => window.clearTimeout(t);
    }
  }, [search.print, invoice.data]);

  if (invoice.isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Cargando comprobante…
      </div>
    );
  }

  if (!invoice.data) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/admin/facturas">
            <ArrowLeft className="mr-1 h-4 w-4" /> Volver a facturas
          </Link>
        </Button>
        <p className="text-sm text-muted-foreground">Comprobante no encontrado.</p>
      </div>
    );
  }

  const inv = invoice.data;

  return (
    <div className="space-y-6 print:space-y-0">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/admin/facturas">
            <ArrowLeft className="mr-1 h-4 w-4" /> Facturas
          </Link>
        </Button>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Printer className="mr-1 h-4 w-4" />
            Imprimir / Descargar PDF
          </Button>
          {inv.booking_id && (
            <Button variant="outline" size="sm" asChild>
              <Link to="/admin/reservas" search={{ booking: inv.booking_id }}>
                <ClipboardList className="mr-1 h-4 w-4" /> Ver reserva
              </Link>
            </Button>
          )}
        </div>
      </div>

      <InvoicePrintable invoice={inv} />
    </div>
  );
}
