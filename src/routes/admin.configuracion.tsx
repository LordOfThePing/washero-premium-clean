import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/admin/configuracion")({
  component: () => (
    <Card>
      <CardHeader><CardTitle>Configuración</CardTitle></CardHeader>
      <CardContent className="text-muted-foreground">Próximamente: ajustes generales.</CardContent>
    </Card>
  ),
});
