import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/admin/reservas")({
  component: () => (
    <Card>
      <CardHeader><CardTitle>Reservas</CardTitle></CardHeader>
      <CardContent className="text-muted-foreground">Próximamente: listado y gestión de reservas.</CardContent>
    </Card>
  ),
});
