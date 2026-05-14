import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/admin/clientes")({
  component: () => (
    <Card>
      <CardHeader><CardTitle>Clientes</CardTitle></CardHeader>
      <CardContent className="text-muted-foreground">Próximamente: base de clientes.</CardContent>
    </Card>
  ),
});
