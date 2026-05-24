import { Link, useRouterState } from "@tanstack/react-router";
import { CalendarDays, CalendarRange, ClipboardList, MessageSquare, User } from "lucide-react";
import { cn } from "@/lib/utils";

const items = [
  { to: "/operator/hoy", label: "Hoy", icon: CalendarDays },
  { to: "/operator/semana", label: "Semana", icon: CalendarRange },
  { to: "/operator/pendientes", label: "Pendientes", icon: ClipboardList },
  { to: "/operator/mensajes", label: "Mensajes", icon: MessageSquare },
  { to: "/operator/perfil", label: "Perfil", icon: User },
] as const;

export function OperatorBottomNav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-border/60 bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      <div className="mx-auto grid max-w-lg grid-cols-5">
        {items.map(({ to, label, icon: Icon }) => {
          const active = pathname === to || pathname.startsWith(`${to}/`);
          return (
            <Link
              key={to}
              to={to}
              className={cn(
                "flex flex-col items-center gap-0.5 py-2.5 text-[10px] font-medium",
                active ? "text-primary" : "text-muted-foreground",
              )}
            >
              <Icon className="h-5 w-5" />
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
