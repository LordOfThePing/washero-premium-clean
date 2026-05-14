import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";

export const Route = createFileRoute("/booking")({
  head: () => ({
    meta: [
      { title: "Reservar lavado — Washero" },
      { name: "description", content: "Reservá tu lavado de auto a domicilio en Zona Norte." },
    ],
  }),
  component: BookingPage,
});

const SERVICES = [
  { id: "express", name: "Lavado Express", price: 12000 },
  { id: "full", name: "Full Detail", price: 22000 },
  { id: "premium", name: "Premium Wax", price: 35000 },
];

const ZONES = ["Maschwitz", "Nordelta", "Escobar", "San Isidro", "Tigre", "Pilar", "Otra"];

function BookingPage() {
  const [step, setStep] = useState(1);
  const [service, setService] = useState(SERVICES[0].id);
  const [zone, setZone] = useState(ZONES[0]);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("10:00");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");

  const selected = SERVICES.find((s) => s.id === service)!;

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12">
        <h1 className="text-3xl font-bold tracking-tight md:text-4xl">Reservar lavado</h1>
        <p className="mt-2 text-muted-foreground">Paso {step} de 3</p>

        <div className="mt-8 rounded-3xl border border-border bg-card p-6 md:p-8">
          {step === 1 && (
            <div className="space-y-5">
              <h2 className="text-xl font-bold">Elegí tu servicio</h2>
              <div className="grid gap-3">
                {SERVICES.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setService(s.id)}
                    className={`flex items-center justify-between rounded-2xl border p-4 text-left transition ${
                      service === s.id
                        ? "border-primary bg-primary/10"
                        : "border-border hover:border-primary/40"
                    }`}
                  >
                    <span className="font-semibold">{s.name}</span>
                    <span className="text-primary font-bold">${s.price.toLocaleString("es-AR")}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-5">
              <h2 className="text-xl font-bold">Día, hora y zona</h2>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="grid gap-1 text-sm">
                  <span className="font-medium">Fecha</span>
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="rounded-xl border border-border bg-background px-3 py-2"
                  />
                </label>
                <label className="grid gap-1 text-sm">
                  <span className="font-medium">Hora</span>
                  <input
                    type="time"
                    value={time}
                    onChange={(e) => setTime(e.target.value)}
                    className="rounded-xl border border-border bg-background px-3 py-2"
                  />
                </label>
                <label className="grid gap-1 text-sm md:col-span-2">
                  <span className="font-medium">Zona</span>
                  <select
                    value={zone}
                    onChange={(e) => setZone(e.target.value)}
                    className="rounded-xl border border-border bg-background px-3 py-2"
                  >
                    {ZONES.map((z) => (
                      <option key={z}>{z}</option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-5">
              <h2 className="text-xl font-bold">Tus datos</h2>
              <div className="grid gap-4">
                <label className="grid gap-1 text-sm">
                  <span className="font-medium">Nombre</span>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="rounded-xl border border-border bg-background px-3 py-2"
                  />
                </label>
                <label className="grid gap-1 text-sm">
                  <span className="font-medium">WhatsApp</span>
                  <input
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+54 9 11 ..."
                    className="rounded-xl border border-border bg-background px-3 py-2"
                  />
                </label>
              </div>

              <div className="mt-4 rounded-2xl bg-muted p-4 text-sm">
                <p className="font-semibold">Resumen</p>
                <p className="mt-1 text-muted-foreground">
                  {selected.name} · {zone} · {date || "—"} {time}
                </p>
                <p className="mt-1 font-bold text-primary">
                  Total: ${selected.price.toLocaleString("es-AR")}
                </p>
              </div>
            </div>
          )}

          <div className="mt-8 flex items-center justify-between">
            <button
              onClick={() => setStep((s) => Math.max(1, s - 1))}
              disabled={step === 1}
              className="rounded-full border border-border px-5 py-2 text-sm font-medium disabled:opacity-40"
            >
              Atrás
            </button>
            {step < 3 ? (
              <button
                onClick={() => setStep((s) => s + 1)}
                className="rounded-full bg-primary px-6 py-2 text-sm font-semibold text-primary-foreground"
              >
                Siguiente
              </button>
            ) : (
              <button
                onClick={() => alert("Reserva enviada (demo)")}
                className="rounded-full bg-primary px-6 py-2 text-sm font-semibold text-primary-foreground"
              >
                Confirmar reserva
              </button>
            )}
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
