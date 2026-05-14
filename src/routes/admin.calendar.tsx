import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/calendar")({
  component: AdminCalendar,
});

function AdminCalendar() {
  const days = Array.from({ length: 35 }, (_, i) => i + 1);
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Calendario</h1>
        <p className="text-muted-foreground">Vista mensual de turnos.</p>
      </header>
      <div className="rounded-2xl border border-border bg-card p-4">
        <div className="grid grid-cols-7 gap-2 text-center text-xs font-semibold uppercase text-muted-foreground">
          {["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"].map((d) => (
            <div key={d} className="py-2">{d}</div>
          ))}
        </div>
        <div className="mt-2 grid grid-cols-7 gap-2">
          {days.map((d) => (
            <div
              key={d}
              className="aspect-square rounded-xl border border-border bg-background p-2 text-sm"
            >
              <span className="text-muted-foreground">{d <= 31 ? d : ""}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
