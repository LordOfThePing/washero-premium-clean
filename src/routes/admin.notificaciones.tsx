import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Bell, Loader2 } from "lucide-react";

export const Route = createFileRoute("/admin/notificaciones")({
  component: NotificacionesPage,
});

function NotificacionesPage() {
  const logs = useQuery({
    queryKey: ["communication_logs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("communication_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Bell className="h-5 w-5" /> Notificaciones
        </h1>
        <p className="text-sm text-muted-foreground">Bitácora de comunicaciones y configuración futura.</p>
      </div>

      <Card className="border-dashed">
        <CardContent className="p-4 text-sm text-muted-foreground">
          Recordatorios automáticos por WhatsApp aún no están automatizados. Próximamente.
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Últimas comunicaciones</CardTitle></CardHeader>
        <CardContent>
          {logs.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
            </div>
          ) : (logs.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin registros.</p>
          ) : (
            <ul className="divide-y divide-border/60">
              {(logs.data ?? []).map((l: any) => (
                <li key={l.id} className="py-3 text-sm">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{l.channel}</Badge>
                    <Badge variant="secondary">{l.direction}</Badge>
                    <span className="text-xs text-muted-foreground">
                      {new Date(l.created_at).toLocaleString("es-AR")}
                    </span>
                  </div>
                  {l.message_text && <p className="mt-1 text-xs">{l.message_text}</p>}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
