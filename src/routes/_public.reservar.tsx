import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/_public/reservar")({
  head: () => ({
    meta: [
      { title: "Reservar lavado — Washero" },
      { name: "description", content: "Reservá tu lavado de auto a domicilio en Zona Norte." },
    ],
  }),
  component: ReservarPage,
});

function ReservarPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-16">
      <Card>
        <CardHeader>
          <CardTitle>Reservar lavado</CardTitle>
        </CardHeader>
        <CardContent className="text-muted-foreground">
          <p>Próximamente: flujo de reserva en pocos pasos.</p>
        </CardContent>
      </Card>
    </div>
  );
}
