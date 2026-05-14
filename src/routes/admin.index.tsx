import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/")({
  component: AdminDashboard,
});

const STATS = [
  { label: "Reservas hoy", value: "8" },
  { label: "Ingresos hoy", value: "$148.000" },
  { label: "Próximo turno", value: "16:00" },
  { label: "Pendientes", value: "3" },
];

function AdminDashboard() {
  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">Resumen del día</p>
      </header>
      <div className="grid gap-4 md:grid-cols-4">
        {STATS.map((s) => (
          <div key={s.label} className="rounded-2xl border border-border bg-card p-5">
            <p className="text-sm text-muted-foreground">{s.label}</p>
            <p className="mt-2 text-2xl font-bold">{s.value}</p>
          </div>
        ))}
      </div>
      <div className="rounded-2xl border border-border bg-card p-6">
        <h2 className="text-lg font-bold">Próximas reservas</h2>
        <p className="mt-2 text-sm text-muted-foreground">Sin datos. Conectá Supabase para ver reservas reales.</p>
      </div>
    </div>
  );
}
