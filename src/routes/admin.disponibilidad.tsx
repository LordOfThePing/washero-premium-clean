import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/admin/disponibilidad")({
  component: () => (
    <Card>
      <CardHeader><CardTitle>Disponibilidad</CardTitle></CardHeader>
      <CardContent className="text-muted-foreground">Próximamente: configuración de horarios y slots.</CardContent>
    </Card>
  ),
});
