import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, TrendingUp } from "lucide-react";

export const Route = createFileRoute("/admin/finanzas")({
  component: FinanzasPage,
});

function fmt(n: number) {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(n);
}

function FinanzasPage() {
  const data = useQuery({
    queryKey: ["finanzas"],
    queryFn: async () => {
      const { data: bookings } = await supabase
        .from("bookings")
        .select("price, payment_method, payment_status, booking_status, scheduled_date")
        .limit(5000);
      const { data: payments } = await supabase
        .from("payments")
        .select("amount, status, provider, created_at")
        .order("created_at", { ascending: false })
        .limit(20);

      const all = bookings ?? [];
      let total = 0, paid = 0, pending = 0, mp = 0, transfer = 0, later = 0;
      const byStatus: Record<string, number> = {};
      for (const b of all) {
        total += b.price;
        if (b.payment_status === "paid") paid += b.price;
        else pending += b.price;
        if (b.payment_method === "MercadoPago") mp += b.price;
        else if (b.payment_method === "Transferencia") transfer += b.price;
        else if (b.payment_method === "Pagar después") later += b.price;
        byStatus[b.booking_status] = (byStatus[b.booking_status] ?? 0) + 1;
      }
      return { total, paid, pending, mp, transfer, later, byStatus, payments: payments ?? [] };
    },
  });

  if (data.isLoading) {
    return <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
    </div>;
  }
  const d = data.data!;

  const cards = [
    { label: "Revenue total", value: d.total },
    { label: "Cobrado", value: d.paid },
    { label: "Pendiente de cobro", value: d.pending },
    { label: "Mercado Pago", value: d.mp },
    { label: "Transferencia", value: d.transfer },
    { label: "Pagar después", value: d.later },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <TrendingUp className="h-5 w-5" /> Finanzas
        </h1>
        <p className="text-sm text-muted-foreground">Visión general de revenue y pagos.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => (
          <Card key={c.label}>
            <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">{c.label}</CardTitle></CardHeader>
            <CardContent><div className="text-2xl font-semibold">{fmt(c.value)}</div></CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Reservas por estado</CardTitle></CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {Object.entries(d.byStatus).map(([k, v]) => (
              <Badge key={k} variant="secondary">{k}: {v}</Badge>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Últimos pagos</CardTitle></CardHeader>
        <CardContent>
          {d.payments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No hay pagos registrados.</p>
          ) : (
            <ul className="divide-y divide-border/60">
              {d.payments.map((p: any, i: number) => (
                <li key={i} className="flex items-center justify-between py-2 text-sm">
                  <div>
                    <p className="font-medium">{fmt(p.amount)}</p>
                    <p className="text-xs text-muted-foreground">{p.provider} · {new Date(p.created_at).toLocaleString("es-AR")}</p>
                  </div>
                  <Badge variant={p.status === "approved" ? "default" : "outline"}>{p.status}</Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
