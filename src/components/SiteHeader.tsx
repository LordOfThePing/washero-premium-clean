import { Link } from "@tanstack/react-router";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 w-full border-b border-border/60 bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
        <Link to="/" className="flex items-center gap-2">
          <span className="inline-block h-8 w-8 rounded-lg bg-primary" />
          <span className="text-lg font-bold tracking-tight">
            Washero<span className="text-primary">.</span>
          </span>
        </Link>
        <nav className="hidden items-center gap-6 text-sm font-medium text-muted-foreground md:flex">
          <a href="/#servicios" className="hover:text-foreground">Servicios</a>
          <a href="/#zonas" className="hover:text-foreground">Zonas</a>
          <a href="/#como-funciona" className="hover:text-foreground">Cómo funciona</a>
        </nav>
        <Link
          to="/booking"
          className="inline-flex items-center justify-center rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
        >
          Reservar
        </Link>
      </div>
    </header>
  );
}
