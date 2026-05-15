import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Map as MapIcon } from "lucide-react";

export const Route = createFileRoute("/admin/mapa-demanda")({
  component: MapaDemandaPage,
});

function fmt(n: number) {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(n);
}

function MapaDemandaPage() {
  const data = useQuery({
    queryKey: ["mapa-demanda"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bookings")
        .select("neighborhood, price, booking_status")
        .limit(5000);
      if (error) throw error;
      type Agg = { count: number; revenue: number; pending: number; confirmed: number; completed: number };
      const map = new Map<string, Agg>();
      for (const b of data ?? []) {
        const k = b.neighborhood || "(sin zona)";
        const cur = map.get(k) ?? { count: 0, revenue: 0, pending: 0, confirmed: 0, completed: 0 };
        cur.count++;
        cur.revenue += b.price ?? 0;
        if (b.booking_status === "pending" || b.booking_status === "needs_review") cur.pending++;
        else if (b.booking_status === "confirmed") cur.confirmed++;
        else if (b.booking_status === "completed") cur.completed++;
        map.set(k, cur);
      }
      return Array.from(map.entries())
        .map(([n, v]) => ({ neighborhood: n, ...v }))
        .sort((a, b) => b.count - a.count);
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <MapIcon className="h-5 w-5" /> Mapa de Demanda
        </h1>
        <p className="text-sm text-muted-foreground">Distribución de reservas por zona.</p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Por zona</CardTitle></CardHeader>
        <CardContent>
          {data.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
            </div>
          ) : (data.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin datos.</p>
          ) : (
            <ul className="divide-y divide-border/60">
              {(data.data ?? []).map((z) => (
                <li key={z.neighborhood} className="grid grid-cols-1 gap-2 py-3 sm:grid-cols-5 sm:items-center">
                  <p className="font-medium">{z.neighborhood}</p>
                  <Badge variant="secondary" className="w-fit">{z.count} reservas</Badge>
                  <span className="text-sm">Pendientes: {z.pending}</span>
                  <span className="text-sm">Confirmadas: {z.confirmed} · Completadas: {z.completed}</span>
                  <span className="text-right font-mono text-sm">{fmt(z.revenue)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
