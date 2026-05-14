import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/availability")({
  component: AdminAvailability,
});

const DAYS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

function AdminAvailability() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Disponibilidad</h1>
        <p className="text-muted-foreground">Configurá los horarios y días de trabajo.</p>
      </header>
      <div className="rounded-2xl border border-border bg-card divide-y divide-border">
        {DAYS.map((d) => (
          <div key={d} className="flex items-center justify-between gap-4 p-4">
            <span className="font-medium">{d}</span>
            <div className="flex items-center gap-2 text-sm">
              <input type="time" defaultValue="09:00" className="rounded-lg border border-border bg-background px-2 py-1" />
              <span className="text-muted-foreground">a</span>
              <input type="time" defaultValue="18:00" className="rounded-lg border border-border bg-background px-2 py-1" />
              <label className="ml-3 inline-flex items-center gap-2">
                <input type="checkbox" defaultChecked={d !== "Domingo"} />
                <span>Activo</span>
              </label>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
