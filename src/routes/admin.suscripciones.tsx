import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CreditCard, Loader2 } from "lucide-react";

export const Route = createFileRoute("/admin/suscripciones")({
  component: SuscripcionesPage,
});

function SuscripcionesPage() {
  const repeat = useQuery({
    queryKey: ["repeat-customers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bookings")
        .select("customer_phone, customer_name")
        .order("created_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      const map = new Map<string, { name: string; count: number }>();
      for (const b of data ?? []) {
        const key = b.customer_phone;
        if (!key) continue;
        const cur = map.get(key) ?? { name: b.customer_name, count: 0 };
        cur.count++;
        map.set(key, cur);
      }
      return Array.from(map.entries())
        .filter(([, v]) => v.count >= 2)
        .map(([phone, v]) => ({ phone, ...v }))
        .sort((a, b) => b.count - a.count);
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Suscripciones</h1>
        <p className="text-sm text-muted-foreground">
          Planes recurrentes y clientes con múltiples reservas.
        </p>
      </div>

      <Card className="border-dashed">
        <CardContent className="flex items-center gap-3 p-6">
          <CreditCard className="h-6 w-6 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium">Suscripciones próximamente</p>
            <p className="text-xs text-muted-foreground">
              Cuando esté disponible, vas a poder crear planes mensuales y cobros automáticos.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Clientes recurrentes ({repeat.data?.length ?? 0})</CardTitle>
        </CardHeader>
        <CardContent>
          {repeat.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Cargando...
            </div>
          ) : (repeat.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No hay clientes con 2+ reservas todavía.</p>
          ) : (
            <ul className="divide-y divide-border/60">
              {(repeat.data ?? []).map((c) => (
                <li key={c.phone} className="flex items-center justify-between py-2 text-sm">
                  <div>
                    <p className="font-medium">{c.name}</p>
                    <p className="text-xs text-muted-foreground">{c.phone}</p>
                  </div>
                  <Badge variant="secondary">{c.count} reservas</Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
