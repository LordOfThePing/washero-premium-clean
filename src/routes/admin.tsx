import { createFileRoute, Link, Outlet, useLocation } from "@tanstack/react-router";

export const Route = createFileRoute("/admin")({
  component: AdminLayout,
});

const NAV = [
  { to: "/admin", label: "Dashboard", exact: true },
  { to: "/admin/bookings", label: "Reservas" },
  { to: "/admin/calendar", label: "Calendario" },
  { to: "/admin/availability", label: "Disponibilidad" },
  { to: "/admin/settings", label: "Precios y ajustes" },
] as const;

function AdminLayout() {
  const { pathname } = useLocation();

  // Login route renders alone, no chrome
  if (pathname === "/admin/login") {
    return <Outlet />;
  }

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="hidden w-64 shrink-0 border-r border-border bg-secondary text-secondary-foreground md:flex md:flex-col">
        <Link to="/admin" className="flex items-center gap-2 px-6 py-5">
          <span className="inline-block h-8 w-8 rounded-lg bg-primary" />
          <span className="text-lg font-bold">Washero<span className="text-primary">.</span></span>
        </Link>
        <nav className="flex flex-1 flex-col gap-1 px-3">
          {NAV.map((n) => {
            const active = n.exact ? pathname === n.to : pathname.startsWith(n.to);
            return (
              <Link
                key={n.to}
                to={n.to}
                className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
                  active
                    ? "bg-primary text-primary-foreground"
                    : "text-secondary-foreground/80 hover:bg-white/5"
                }`}
              >
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="px-6 py-4 text-xs text-secondary-foreground/60">Admin · Washero</div>
      </aside>
      <main className="flex-1 overflow-x-hidden">
        <div className="mx-auto max-w-6xl p-6 md:p-10">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
