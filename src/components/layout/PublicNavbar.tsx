import { Link } from "@tanstack/react-router";
import { Menu, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import { Logo } from "@/components/brand/Logo";

const navLinks = [
  { label: "Inicio", to: "/" as const },
  { label: "Reservar lavado", to: "/reservar" as const },
  { label: "Zonas", to: "/" as const, hash: "zonas" },
  { label: "Servicios", to: "/" as const, hash: "servicios" },
];

export function PublicNavbar() {
  return (
    <header className="sticky top-0 z-40 w-full border-b border-border/60 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
        <Logo />

        <nav className="hidden items-center gap-6 md:flex">
          {navLinks.map((l) => (
            <Link
              key={l.label}
              to={l.to}
              hash={l.hash}
              className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-2 md:flex">
          <Button variant="ghost" size="sm" asChild>
            <a href="#" aria-label="WhatsApp">
              <MessageCircle className="h-4 w-4" />
              WhatsApp
            </a>
          </Button>
          <Button size="sm" asChild>
            <Link to="/reservar">Reservar lavado</Link>
          </Button>
        </div>

        <Sheet>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="md:hidden" aria-label="Abrir menú">
              <Menu className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="right" className="w-72">
            <SheetTitle className="text-base">Menú</SheetTitle>
            <div className="mt-6 flex flex-col gap-1">
              {navLinks.map((l) => (
                <Link
                  key={l.label}
                  to={l.to}
                  hash={l.hash}
                  className="rounded-md px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
                >
                  {l.label}
                </Link>
              ))}
              <div className="mt-4 flex flex-col gap-2">
                <Button asChild>
                  <Link to="/reservar">Reservar lavado</Link>
                </Button>
                <Button variant="outline" asChild>
                  <a href="#">
                    <MessageCircle className="h-4 w-4" />
                    WhatsApp
                  </a>
                </Button>
              </div>
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  );
}
