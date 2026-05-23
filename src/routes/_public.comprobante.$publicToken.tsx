import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Home, Loader2, Printer } from "lucide-react";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { InvoicePrintable } from "@/components/InvoicePrintable";
import { fetchPublicInvoiceByToken } from "@/lib/invoices";

const searchSchema = z.object({
  print: z.enum(["1"]).optional(),
});

export const Route = createFileRoute("/_public/comprobante/$publicToken")({
  validateSearch: searchSchema,
  component: PublicReceiptPage,
});

function PublicReceiptPage() {
  const { publicToken } = Route.useParams();
  const search = Route.useSearch();

  const invoice = useQuery({
    queryKey: ["public-receipt", publicToken],
    queryFn: () => fetchPublicInvoiceByToken(publicToken),
  });

  useEffect(() => {
    if (search.print === "1" && invoice.data) {
      const t = window.setTimeout(() => window.print(), 400);
      return () => window.clearTimeout(t);
    }
  }, [search.print, invoice.data]);

  if (invoice.isLoading) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-12 text-sm text-muted-foreground">
        <span className="inline-flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          Cargando comprobante...
        </span>
      </div>
    );
  }

  if (!invoice.data) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 px-4 py-12 text-center">
        <p className="text-sm text-muted-foreground">No encontramos el comprobante solicitado.</p>
        <Button asChild variant="outline">
          <Link to="/">
            <Home className="mr-1 h-4 w-4" />
            Volver a Washero
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-8 sm:py-12">
      <div className="no-print flex justify-end">
        <Button variant="outline" onClick={() => window.print()} className="no-print">
          <Printer className="mr-1 h-4 w-4" />
          Imprimir / Descargar PDF
        </Button>
      </div>
      <div className="invoice-print-root">
        <InvoicePrintable invoice={invoice.data} />
      </div>
    </div>
  );
}
