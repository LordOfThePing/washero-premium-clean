import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Washero — Lavado de autos premium a domicilio en Zona Norte" },
      {
        name: "description",
        content:
          "Reservá un lavado de auto profesional a domicilio en Maschwitz, Nordelta, Escobar, San Isidro, Tigre y Pilar. Rápido, eco y premium.",
      },
      { property: "og:title", content: "Washero — Lavado premium a domicilio" },
      {
        property: "og:description",
        content: "Lavado de autos a domicilio en Zona Norte, Buenos Aires.",
      },
    ],
  }),
  component: LandingPage,
});

const ZONES = ["Maschwitz", "Nordelta", "Escobar", "San Isidro", "Tigre", "Pilar", "Zona Norte GBA"];

const SERVICES = [
  { name: "Lavado Express", desc: "Exterior completo, secado a mano y llantas.", price: "Desde $12.000" },
  { name: "Full Detail", desc: "Exterior + interior, plásticos, vidrios y aromatizado.", price: "Desde $22.000" },
  { name: "Premium Wax", desc: "Full detail + cera de protección y brillo profundo.", price: "Desde $35.000" },
];

const STEPS = [
  { n: "01", t: "Elegí tu servicio", d: "Seleccioná el lavado ideal para tu auto." },
  { n: "02", t: "Reservá día y hora", d: "Coordinamos en tu casa, oficina o country." },
  { n: "03", t: "Disfrutá tu auto", d: "Vamos con todo el equipo. Vos no movés nada." },
];

function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader />

      <main className="flex-1">
        {/* Hero */}
        <section className="relative overflow-hidden">
          <div className="absolute inset-0 -z-10 bg-gradient-to-br from-primary/20 via-background to-background" />
          <div className="mx-auto grid max-w-6xl gap-10 px-4 py-20 md:grid-cols-2 md:py-28">
            <div className="flex flex-col justify-center gap-6">
              <span className="inline-flex w-fit items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium">
                <span className="h-2 w-2 rounded-full bg-primary" />
                Zona Norte · Buenos Aires
              </span>
              <h1 className="text-4xl font-bold leading-tight tracking-tight md:text-6xl">
                Tu auto impecable, <span className="text-primary">sin moverte de casa.</span>
              </h1>
              <p className="text-lg text-muted-foreground">
                Lavado premium a domicilio en Maschwitz, Nordelta, Escobar, San Isidro, Tigre y Pilar.
                Reservá online en menos de un minuto.
              </p>
              <div className="flex flex-wrap gap-3">
                <Link
                  to="/booking"
                  className="inline-flex items-center justify-center rounded-full bg-primary px-6 py-3 text-base font-semibold text-primary-foreground shadow-lg shadow-primary/20 transition hover:opacity-90"
                >
                  Reservar lavado
                </Link>
                <a
                  href="#servicios"
                  className="inline-flex items-center justify-center rounded-full border border-border bg-card px-6 py-3 text-base font-semibold transition hover:bg-muted"
                >
                  Ver servicios
                </a>
              </div>
            </div>
            <div className="relative aspect-[4/3] overflow-hidden rounded-3xl bg-secondary">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,oklch(0.78_0.18_75/0.4),transparent_60%)]" />
              <div className="absolute bottom-6 left-6 right-6 rounded-2xl bg-card/90 p-5 shadow-xl backdrop-blur">
                <p className="text-sm text-muted-foreground">Próximo turno disponible</p>
                <p className="mt-1 text-xl font-bold">Hoy · 16:00 hs</p>
              </div>
            </div>
          </div>
        </section>

        {/* Services */}
        <section id="servicios" className="mx-auto max-w-6xl px-4 py-20">
          <h2 className="text-3xl font-bold tracking-tight md:text-4xl">Servicios</h2>
          <p className="mt-2 text-muted-foreground">Elegí el plan que mejor se adapta a tu auto.</p>
          <div className="mt-10 grid gap-6 md:grid-cols-3">
            {SERVICES.map((s) => (
              <div
                key={s.name}
                className="group rounded-3xl border border-border bg-card p-6 transition hover:-translate-y-1 hover:border-primary/60 hover:shadow-xl"
              >
                <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15 text-primary">
                  ✦
                </div>
                <h3 className="text-xl font-bold">{s.name}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{s.desc}</p>
                <p className="mt-6 font-semibold text-primary">{s.price}</p>
              </div>
            ))}
          </div>
        </section>

        {/* How it works */}
        <section id="como-funciona" className="bg-secondary text-secondary-foreground">
          <div className="mx-auto max-w-6xl px-4 py-20">
            <h2 className="text-3xl font-bold tracking-tight md:text-4xl">Cómo funciona</h2>
            <div className="mt-10 grid gap-6 md:grid-cols-3">
              {STEPS.map((s) => (
                <div key={s.n} className="rounded-3xl border border-white/10 p-6">
                  <p className="text-sm font-bold text-primary">{s.n}</p>
                  <h3 className="mt-3 text-xl font-bold">{s.t}</h3>
                  <p className="mt-2 text-sm text-secondary-foreground/70">{s.d}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Zones */}
        <section id="zonas" className="mx-auto max-w-6xl px-4 py-20">
          <h2 className="text-3xl font-bold tracking-tight md:text-4xl">Zonas de cobertura</h2>
          <p className="mt-2 text-muted-foreground">Llegamos a toda la Zona Norte de Buenos Aires.</p>
          <div className="mt-8 flex flex-wrap gap-2">
            {ZONES.map((z) => (
              <span
                key={z}
                className="rounded-full border border-border bg-card px-4 py-2 text-sm font-medium"
              >
                {z}
              </span>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section className="mx-auto max-w-6xl px-4 pb-20">
          <div className="rounded-3xl bg-primary p-10 text-primary-foreground md:p-14">
            <h2 className="text-3xl font-bold md:text-4xl">¿Listo para un auto impecable?</h2>
            <p className="mt-2 max-w-xl text-primary-foreground/80">
              Reservá tu turno en segundos. Te confirmamos por WhatsApp.
            </p>
            <Link
              to="/booking"
              className="mt-6 inline-flex items-center justify-center rounded-full bg-secondary px-6 py-3 text-base font-semibold text-secondary-foreground transition hover:opacity-90"
            >
              Reservar ahora
            </Link>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
