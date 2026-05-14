import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/bookings")({
  component: AdminBookings,
});

function AdminBookings() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Reservas</h1>
        <p className="text-muted-foreground">Gestioná todas las reservas de Washero.</p>
      </header>
      <div className="rounded-2xl border border-border bg-card">
        <div className="grid grid-cols-5 gap-4 border-b border-border px-5 py-3 text-xs font-semibold uppercase text-muted-foreground">
          <span>Cliente</span>
          <span>Servicio</span>
          <span>Zona</span>
          <span>Fecha</span>
          <span>Estado</span>
        </div>
        <div className="px-5 py-10 text-center text-sm text-muted-foreground">
          Sin reservas. Conectá Supabase para listar reservas reales.
        </div>
      </div>
    </div>
  );
}
