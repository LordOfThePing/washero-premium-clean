import { createFileRoute, Link } from "@tanstack/react-router";
import { MessageCircle, Sparkles, MapPin, Droplets } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export const Route = createFileRoute("/_public/")({
  head: () => ({
    meta: [
      { title: "Washero — Lavado de autos a domicilio en Zona Norte" },
      {
        name: "description",
        content:
          "Reservá tu lavado de auto a domicilio en Zona Norte en menos de 1 minuto. Vamos a tu casa, barrio o empresa.",
      },
    ],
  }),
  component: LandingPage,
});

const features = [
  {
    icon: Sparkles,
    title: "Reservá online",
    body: "En menos de 1 minuto elegís servicio, día y horario.",
  },
  {
    icon: MapPin,
    title: "Vamos a tu casa",
    body: "Cubrimos toda Zona Norte: tu casa, barrio o empresa.",
  },
  {
    icon: Droplets,
    title: "Productos premium",
    body: "Lavado profesional con productos de alta gama.",
  },
];

function LandingPage() {
  return (
    <>
      <section className="relative overflow-hidden">
        <div className="mx-auto max-w-6xl px-4 py-20 md:py-28">
          <div className="max-w-3xl">
            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-muted/50 px-3 py-1 text-xs font-medium text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" />
              Zona Norte · Buenos Aires
            </span>
            <h1 className="mt-6 text-4xl font-bold tracking-tight text-foreground md:text-6xl">
              Lavado de autos a domicilio en Zona Norte
            </h1>
            <p className="mt-5 max-w-2xl text-lg text-muted-foreground md:text-xl">
              Reservá tu lavado online en menos de 1 minuto. Nosotros vamos a tu casa, barrio o empresa.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button size="lg" asChild>
                <Link to="/reservar">Reservar lavado</Link>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <a href="#">
                  <MessageCircle className="h-4 w-4" />
                  Consultar por WhatsApp
                </a>
              </Button>
            </div>
          </div>
        </div>
      </section>

      <section id="servicios" className="border-t border-border/60 bg-muted/30">
        <div className="mx-auto grid max-w-6xl gap-4 px-4 py-16 md:grid-cols-3">
          {features.map((f) => (
            <Card key={f.title} className="border-border/60">
              <CardContent className="p-6">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <f.icon className="h-5 w-5" />
                </div>
                <h3 className="mt-4 text-lg font-semibold text-foreground">{f.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{f.body}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
    </>
  );
}
