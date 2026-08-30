import { createFileRoute, Link } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MessageCircle } from "lucide-react";

export const Route = createFileRoute("/admin/whatsapp-config")({
  component: WhatsappConfigPage,
});

function WhatsappConfigPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <MessageCircle className="h-5 w-5" /> WhatsApp Config
        </h1>
        <p className="text-sm text-muted-foreground">Configuración del canal WhatsApp.</p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Proveedor activo</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex items-center gap-2"><Badge>WhatsApp Cloud API (n8n)</Badge><span className="text-muted-foreground">n8n recibe y envía mensajes directo con Meta</span></div>
          <p className="text-muted-foreground text-xs">Para diagnóstico de envíos y eventos, ver la sección WhatsApp / Notificaciones.</p>
          <div className="flex gap-2 pt-2">
            <Button asChild size="sm" variant="outline"><Link to="/admin/whatsapp-events">Ver diagnóstico</Link></Button>
            <Button asChild size="sm" variant="outline"><Link to="/admin/mensajes">Ver mensajes</Link></Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-dashed">
        <CardContent className="p-4 text-sm text-muted-foreground">
          La configuración del número WhatsApp comercial (Meta Business, plantillas, credenciales)
          se administra desde n8n — ver <code>docs/n8n-whatsapp-cloudapi-cutover.md</code>.
        </CardContent>
      </Card>
    </div>
  );
}
