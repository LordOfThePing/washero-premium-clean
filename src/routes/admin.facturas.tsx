import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, FileText } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/facturas")({
  component: FacturasPage,
});

function FacturasPage() {
  const qc = useQueryClient();

  const data = useQuery({
    queryKey: ["facturas"],
    queryFn: async () => {
      const [{ data: bookings }, { data: invoices }] = await Promise.all([
        supabase.from("bookings")
          .select("id, customer_name, scheduled_date, price, payment_status, booking_status")
          .in("booking_status", ["completed", "confirmed"])
          .order("scheduled_date", { ascending: false })
          .limit(500),
        supabase.from("invoices").select("*").limit(500),
      ]);
      return { bookings: bookings ?? [], invoices: invoices ?? [] };
    },
  });

  const invoiceFor = (bookingId: string) =>
    (data.data?.invoices ?? []).find((i: any) => i.booking_id === bookingId);

  const markIssued = async (bookingId: string) => {
    const existing = invoiceFor(bookingId);
    const payload = { status: "issued", issued_at: new Date().toISOString() };
    const { error } = existing
      ? await supabase.from("invoices").update(payload).eq("id", existing.id)
      : await supabase.from("invoices").insert({ booking_id: bookingId, ...payload });
    if (error) {
      toast.error("Error", { description: error.message });
      return;
    }
    toast.success("Factura marcada como emitida");
    qc.invalidateQueries({ queryKey: ["facturas"] });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <FileText className="h-5 w-5" /> Facturas
        </h1>
        <p className="text-sm text-muted-foreground">Gestión MVP de facturas (sin AFIP automático).</p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Reservas facturables ({data.data?.bookings.length ?? 0})</CardTitle></CardHeader>
        <CardContent>
          {data.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
            </div>
          ) : (data.data?.bookings ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No hay reservas facturables.</p>
          ) : (
            <ul className="divide-y divide-border/60">
              {(data.data?.bookings ?? []).map((b: any) => {
                const inv = invoiceFor(b.id);
                return (
                  <li key={b.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{b.customer_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {b.scheduled_date} · ${b.price?.toLocaleString("es-AR")}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={inv?.status === "issued" ? "default" : "outline"}>
                        {inv?.status ?? "Pendiente"}
                      </Badge>
                      {inv?.status !== "issued" && (
                        <Button size="sm" variant="outline" onClick={() => markIssued(b.id)}>
                          Marcar emitida
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
