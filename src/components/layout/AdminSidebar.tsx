import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  CalendarDays,
  CalendarClock,
  ClipboardList,
  Users,
  Settings,
  MessageSquare,
  CreditCard,
  UserCircle,
  Sparkles,
  Shield,
  Map,
  TrendingUp,
  FileText,
  Tag,
  Bell,
  MessageCircle,
  Bot,
  Cog,
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

const primary = [
  { title: "Dashboard", to: "/admin" as const, icon: LayoutDashboard },
  { title: "Reservas", to: "/admin/reservas" as const, icon: ClipboardList },
  { title: "Calendario", to: "/admin/calendario" as const, icon: CalendarDays },
  { title: "Mensajes", to: "/admin/mensajes" as const, icon: MessageSquare },
  { title: "Disponibilidad", to: "/admin/disponibilidad" as const, icon: CalendarClock },
  { title: "Clientes", to: "/admin/clientes" as const, icon: Users },
  { title: "Suscripciones", to: "/admin/suscripciones" as const, icon: CreditCard },
];

const crm = [
  { title: "Contactos", to: "/admin/clientes" as const, icon: UserCircle },
  { title: "Early Access", to: "/admin/early-access" as const, icon: Sparkles },
  { title: "Leads Kipper", to: "/admin/leads-kipper" as const, icon: Shield },
];

const ops = [
  { title: "Mapa Demanda", to: "/admin/mapa-demanda" as const, icon: Map },
];

const finance = [
  { title: "Finanzas", to: "/admin/finanzas" as const, icon: TrendingUp },
  { title: "Facturas", to: "/admin/facturas" as const, icon: FileText },
];

const config = [
  { title: "Precios", to: "/admin/precios" as const, icon: Tag },
  { title: "Notificaciones", to: "/admin/notificaciones" as const, icon: Bell },
  { title: "WhatsApp Config", to: "/admin/whatsapp-config" as const, icon: MessageCircle },
  { title: "Botmaker", to: "/admin/botmaker" as const, icon: Bot },
  { title: "App Config", to: "/admin/app-config" as const, icon: Cog },
  { title: "Configuración", to: "/admin/configuracion" as const, icon: Settings },
];

export function AdminSidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const renderItems = (items: typeof primary) =>
    items.map((item) => {
      const active = item.to === "/admin" ? pathname === "/admin" : pathname === item.to;
      return (
        <SidebarMenuItem key={item.title + item.to}>
          <SidebarMenuButton asChild isActive={active}>
            <Link to={item.to} className="flex items-center gap-2">
              <item.icon className="h-4 w-4" />
              <span>{item.title}</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      );
    });

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="px-2 py-2">
          <Logo />
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Operación</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>{renderItems(primary)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>CRM &amp; Ventas</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>{renderItems(crm)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Demanda</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>{renderItems(ops)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Finanzas</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>{renderItems(finance)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Configuración</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>{renderItems(config)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
