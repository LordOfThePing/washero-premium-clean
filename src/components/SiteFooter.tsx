export function SiteFooter() {
  return (
    <footer className="border-t border-border/60 bg-secondary text-secondary-foreground">
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-8 text-sm md:flex-row md:items-center md:justify-between">
        <p className="font-semibold">Washero — Lavado premium a domicilio</p>
        <p className="text-secondary-foreground/70">
          Zona Norte, Buenos Aires · © {new Date().getFullYear()}
        </p>
      </div>
    </footer>
  );
}
