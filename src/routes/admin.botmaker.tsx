import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Bot, Loader2 } from "lucide-react";

const PROJECT_REF = "domslcbxgqbylmciqrxt";
const WEBHOOK_URL = `https://${PROJECT_REF}.supabase.co/functions/v1/botmaker-webhook`;

export const Route = createFileRoute("/admin/botmaker")({
  component: BotmakerPage,
});

function BotmakerPage() {
  const events = useQuery({
    queryKey: ["botmaker_events"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("botmaker_events")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data ?? [];
    },
  });

  const requests = useQuery({
    queryKey: ["botmaker-booking-requests"],
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
            <Bot className="h-5 w-5" /> Botmaker
          </h1>
          <p className="text-sm text-muted-foreground">Webhook, diagnóstico y solicitudes recientes.</p>
        </div>
        <Button asChild size="sm" variant="outline"><Link to="/admin/mensajes">Ver mensajes</Link></Button>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Webhook</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <code className="block break-all rounded bg-muted p-2 text-xs">{WEBHOOK_URL}</code>
          <p className="text-xs text-muted-foreground">
            Botmaker debe enviar el header <code>auth-bm-token</code> con el valor del secret <code>BOTMAKER_WEBHOOK_SECRET</code>.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Eventos recientes</CardTitle></CardHeader>
        <CardContent>
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
        <CardHeader><CardTitle className="text-base">Solicitudes desde Botmaker</CardTitle></CardHeader>
        <CardContent>
          {requests.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
            </div>
          ) : (requests.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin solicitudes.</p>
          ) : (
            <ul className="divide-y divide-border/60">
              {(requests.data ?? []).map((r: any) => (
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
