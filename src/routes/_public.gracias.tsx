import { createFileRoute, Link } from "@tanstack/react-router";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export const Route = createFileRoute("/_public/gracias")({
  head: () => ({
    meta: [{ title: "¡Gracias! — Washero" }],
  }),
  component: GraciasPage,
});

function GraciasPage() {
  return (
    <div className="mx-auto max-w-xl px-4 py-20">
      <Card>
        <CardContent className="flex flex-col items-center p-10 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/15 text-primary">
            <CheckCircle2 className="h-6 w-6" />
          </div>
          <h1 className="mt-4 text-2xl font-semibold">¡Gracias por tu reserva!</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Te vamos a contactar por WhatsApp para confirmar los detalles.
          </p>
          <Button className="mt-6" asChild>
            <Link to="/">Volver al inicio</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
