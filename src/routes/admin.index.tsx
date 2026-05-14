import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/admin/")({
  component: AdminDashboard,
});

function AdminDashboard() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Resumen del día.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {["Reservas hoy", "Ingresos del día", "Próximos turnos"].map((t) => (
          <Card key={t}>
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground">{t}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold">—</div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
