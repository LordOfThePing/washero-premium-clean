import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Bot, Loader2 } from "lucide-react";

export const Route = createFileRoute("/admin/whatsapp-events")({
  component: WhatsappEventsPage,
});

function WhatsappEventsPage() {
  const events = useQuery({
    queryKey: ["whatsapp_events"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("whatsapp_events")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data ?? [];
    },
  });

  const legacyRequests = useQuery({
    queryKey: ["legacy-botmaker-booking-requests"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("booking_requests")
        .select("id, customer_name, status, created_at, missing_fields")
        .eq("source", "botmaker")
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Bot className="h-5 w-5" /> WhatsApp
          </h1>
          <p className="text-sm text-muted-foreground">
            Eventos crudos y datos históricos. El transporte de WhatsApp (recepción y envío) vive en n8n —
            ver <code>docs/n8n-whatsapp-cloudapi-cutover.md</code>.
          </p>
        </div>
        <Button asChild size="sm" variant="outline"><Link to="/admin/mensajes">Ver mensajes</Link></Button>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Eventos recientes</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Esta tabla ya no recibe eventos nuevos automáticamente: Meta envía los webhooks directo a n8n,
            no a Supabase. Solo va a mostrar historial previo al cutover, salvo que se agregue un paso en
            n8n que registre eventos acá también.
          </p>
          {events.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
            </div>
          ) : (events.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin eventos.</p>
          ) : (
            <ul className="divide-y divide-border/60">
              {(events.data ?? []).map((e: any) => (
                <li key={e.id} className="flex items-center justify-between py-2 text-sm">
                  <div>
                    <p className="font-medium">{e.event_type ?? "(sin tipo)"} <span className="text-xs text-muted-foreground">{e.customer_phone}</span></p>
                    <p className="text-xs text-muted-foreground">{new Date(e.created_at).toLocaleString("es-AR")}</p>
                  </div>
                  <Badge variant={e.auth_valid ? "default" : "destructive"}>{e.auth_valid ? "auth ok" : "auth fail"}</Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Solicitudes históricas (transporte Botmaker, retirado)</CardTitle></CardHeader>
        <CardContent>
          {legacyRequests.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
            </div>
          ) : (legacyRequests.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin solicitudes.</p>
          ) : (
            <ul className="divide-y divide-border/60">
              {(legacyRequests.data ?? []).map((r: any) => (
                <li key={r.id} className="flex items-center justify-between py-2 text-sm">
                  <div>
                    <p className="font-medium">{r.customer_name ?? "(sin nombre)"}</p>
                    <p className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString("es-AR")}</p>
                  </div>
                  <Badge variant="outline">{r.status}</Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
