import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/admin/calendario")({
  component: () => (
    <Card>
      <CardHeader><CardTitle>Calendario</CardTitle></CardHeader>
      <CardContent className="text-muted-foreground">Próximamente: vista de calendario.</CardContent>
    </Card>
  ),
});
