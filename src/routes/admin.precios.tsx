import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Loader2, Tag } from "lucide-react";

export const Route = createFileRoute("/admin/precios")({
  component: PreciosPage,
});

const SURCHARGES = [
  { vehicle: "Auto", price: 0 },
  { vehicle: "SUV", price: 5000 },
  { vehicle: "Pick-up", price: 8000 },
  { vehicle: "Otro", price: 0 },
];

const EXTRAS = [
  { id: "encerado_rapido", label: "Encerado rápido", price: 8000 },
  { id: "detallado_interior_profundo", label: "Detallado interior profundo", price: 9000 },
  { id: "eliminacion_olores", label: "Eliminación de olores", price: 12000 },
  { id: "barro_auto_muy_sucio", label: "Barro / Auto muy sucio", price: 7000 },
  { id: "pelo_mascotas", label: "Pelo de mascotas", price: 10000 },
];

function PreciosPage() {
  const services = useQuery({
    queryKey: ["services"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("services")
        .select("*")
        .order("name", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Tag className="h-5 w-5" /> Precios
          </h1>
          <p className="text-sm text-muted-foreground">Servicios, recargos por vehículo y extras.</p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to="/admin/configuracion">Editar servicios</Link>
        </Button>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Servicios</CardTitle></CardHeader>
        <CardContent>
          {services.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
            </div>
          ) : (
            <ul className="divide-y divide-border/60">
              {(services.data ?? []).map((s: any) => (
                <li key={s.id} className="flex items-center justify-between py-3">
                  <div>
                    <p className="text-sm font-medium">{s.name}</p>
                    <p className="text-xs text-muted-foreground">{s.duration_minutes} min</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={s.active ? "default" : "outline"}>{s.active ? "Activo" : "Inactivo"}</Badge>
                    <span className="font-semibold">${s.base_price?.toLocaleString("es-AR")}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Recargos por vehículo (read-only)</CardTitle></CardHeader>
        <CardContent>
          <ul className="divide-y divide-border/60">
            {SURCHARGES.map((s) => (
              <li key={s.vehicle} className="flex items-center justify-between py-2 text-sm">
                <span>{s.vehicle}</span>
                <span className="font-mono">+${s.price.toLocaleString("es-AR")}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Extras (read-only)</CardTitle></CardHeader>
        <CardContent>
          <ul className="divide-y divide-border/60">
            {EXTRAS.map((e) => (
              <li key={e.id} className="flex items-center justify-between py-2 text-sm">
                <span>{e.label}</span>
                <span className="font-mono">+${e.price.toLocaleString("es-AR")}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card className="border-amber-300/60 bg-amber-50/40">
        <CardContent className="flex items-start gap-2 p-4 text-xs">
          <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-600" />
          <p>Estos valores están definidos en backend (booking-core). Para editarlos desde admin se requiere tabla de configuración.</p>
        </CardContent>
      </Card>
    </div>
  );
}
