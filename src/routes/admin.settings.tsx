import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/settings")({
  component: AdminSettings,
});

const SERVICES = [
  { name: "Lavado Express", price: 12000 },
  { name: "Full Detail", price: 22000 },
  { name: "Premium Wax", price: 35000 },
];

function AdminSettings() {
  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Precios y ajustes</h1>
        <p className="text-muted-foreground">Editá precios de servicios y datos del negocio.</p>
      </header>

      <section className="rounded-2xl border border-border bg-card p-6">
        <h2 className="text-lg font-bold">Servicios</h2>
        <div className="mt-4 space-y-3">
          {SERVICES.map((s) => (
            <div key={s.name} className="flex items-center justify-between gap-4">
              <span className="font-medium">{s.name}</span>
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">$</span>
                <input
                  type="number"
                  defaultValue={s.price}
                  className="w-32 rounded-lg border border-border bg-background px-2 py-1 text-right"
                />
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-card p-6">
        <h2 className="text-lg font-bold">Negocio</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="grid gap-1 text-sm">
            <span className="font-medium">Nombre comercial</span>
            <input defaultValue="Washero" className="rounded-lg border border-border bg-background px-3 py-2" />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="font-medium">WhatsApp</span>
            <input defaultValue="+54 9 11 ..." className="rounded-lg border border-border bg-background px-3 py-2" />
          </label>
        </div>
      </section>

      <button className="rounded-full bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground">
        Guardar cambios
      </button>
    </div>
  );
}
