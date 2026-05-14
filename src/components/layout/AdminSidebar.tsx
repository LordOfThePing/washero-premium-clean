import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  CalendarDays,
  CalendarClock,
  ClipboardList,
  Users,
  Settings,
  MessageSquare,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { Logo } from "@/components/brand/Logo";

const items = [
  { title: "Dashboard", to: "/admin" as const, icon: LayoutDashboard },
  { title: "Reservas", to: "/admin/reservas" as const, icon: ClipboardList },
  { title: "Calendario", to: "/admin/calendario" as const, icon: CalendarDays },
  { title: "Disponibilidad", to: "/admin/disponibilidad" as const, icon: CalendarClock },
  { title: "Clientes", to: "/admin/clientes" as const, icon: Users },
  { title: "Mensajes", to: "/admin/mensajes" as const, icon: MessageSquare },
  { title: "Configuración", to: "/admin/configuracion" as const, icon: Settings },
];

export function AdminSidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="px-2 py-2">
          <Logo />
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Administración</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => {
                const active = item.to === "/admin" ? pathname === "/admin" : pathname.startsWith(item.to);
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild isActive={active}>
                      <Link to={item.to} className="flex items-center gap-2">
                        <item.icon className="h-4 w-4" />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
