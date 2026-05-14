import { Logo } from "@/components/brand/Logo";

export function PublicFooter() {
  return (
    <footer className="border-t border-border/60 bg-background">
      <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-4 px-4 py-8 text-sm text-muted-foreground md:flex-row md:items-center">
        <div className="flex flex-col gap-1">
          <Logo />
          <p>Lavado premium a domicilio en Zona Norte, Buenos Aires.</p>
        </div>
        <div className="flex items-center gap-4">
          <a href="#" className="hover:text-foreground">WhatsApp</a>
          <span>© {new Date().getFullYear()} Washero</span>
        </div>
      </div>
    </footer>
  );
}
