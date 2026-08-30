import { type FormEvent, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2, Pencil, Plus, Power, Tag, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { db } from "@/integrations/db/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/admin/precios")({
  component: PreciosPage,
});

type ServiceRow = {
  id: string;
  name: string;
  description: string | null;
  base_price: number;
  duration_minutes: number;
  active: boolean;
  created_at?: string;
  updated_at?: string;
};

type PricingType = "vehicle_surcharge" | "extra";

type PricingItemRow = {
  id: string;
  type: PricingType;
  code: string;
  name: string;
  description: string | null;
  amount: number;
  duration_minutes: number;
  active: boolean;
  display_order: number;
  created_at?: string;
  updated_at?: string;
};

type BookingUsageRow = {
  id: string;
  service_id: string | null;
  service_name: string;
  vehicle_type: string;
  selected_extras: unknown;
  price_breakdown: unknown;
};

type DeleteTarget =
  | { kind: "service"; item: ServiceRow; usage: number }
  | { kind: "pricing"; item: PricingItemRow; usage: number };

const VEHICLE_CODE_TO_TYPE: Record<string, string[]> = {
  auto: ["Auto"],
  suv: ["SUV"],
  pickup: ["Pick-up", "Pickup", "Pick Up", "Van"],
};

const CODE_RE = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;

function formatARS(value: number) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(Number(value) || 0);
}

function normalizeText(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function helperText(active: boolean, subject: "service" | "item") {
  const state = active ? "Activo en reservas nuevas" : "Oculto para reservas nuevas";
  const source =
    subject === "service"
      ? "Duración usada para disponibilidad y solapamientos."
      : "Usado por /reservar y booking-core.";
  return `${state}. ${source}`;
}

function parseJsonArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function bookingUsesPricingItem(booking: BookingUsageRow, item: PricingItemRow) {
  const breakdown = normalizeText(JSON.stringify(booking.price_breakdown ?? {}));
  const code = normalizeText(item.code);
  const name = normalizeText(item.name);

  if (item.type === "extra") {
    const extras = parseJsonArray(booking.selected_extras).map(normalizeText);
    return extras.includes(code) || breakdown.includes(code) || breakdown.includes(name);
  }

  const vehicle = normalizeText(booking.vehicle_type);
  const mappedTypes = VEHICLE_CODE_TO_TYPE[item.code] ?? [item.code, item.name];
  const vehicleMatches = mappedTypes.some((candidate) => {
    const n = normalizeText(candidate);
    return vehicle === n || vehicle.includes(n) || n.includes(vehicle);
  });
  return vehicleMatches || breakdown.includes(code) || breakdown.includes(name);
}

function PreciosPage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Tag className="h-5 w-5" /> Precios
          </h1>
          <p className="text-sm text-muted-foreground">
            Gestioná servicios, recargos y extras. Los cambios aplican solo a nuevas reservas.
          </p>
        </div>
      </div>

      <Card className="border-amber-300/60 bg-amber-50/50 dark:bg-amber-950/20">
        <CardContent className="flex items-start gap-2 p-4 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <p>
            Los cambios de precios no modifican reservas ya creadas. Las reservas existentes
            conservan su{" "}
            <code className="rounded bg-background/70 px-1 py-0.5 text-xs">price_breakdown</code>.
          </p>
        </CardContent>
      </Card>

      <Tabs defaultValue="services" className="space-y-4">
        <TabsList className="h-auto flex-wrap justify-start">
          <TabsTrigger value="services">Servicios</TabsTrigger>
          <TabsTrigger value="vehicles">Recargos por vehículo</TabsTrigger>
          <TabsTrigger value="extras">Extras</TabsTrigger>
        </TabsList>

        <TabsContent value="services">
          <ServicesTab />
        </TabsContent>
        <TabsContent value="vehicles">
          <PricingItemsTab type="vehicle_surcharge" />
        </TabsContent>
        <TabsContent value="extras">
          <PricingItemsTab type="extra" />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ServicesTab() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<ServiceRow | "new" | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);

  const services = useQuery({
    queryKey: ["admin", "precios", "services"],
    queryFn: async () => {
      const { data, error } = await db
        .from("services")
        .select("*")
        .order("name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as ServiceRow[];
    },
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["admin", "precios", "services"] });
    qc.invalidateQueries({ queryKey: ["services"] });
    qc.invalidateQueries({ queryKey: ["public", "services"] });
  };

  const toggleActive = useMutation({
    mutationFn: async (service: ServiceRow) => {
      const { error } = await db
        .from("services")
        .update({ active: !service.active })
        .eq("id", service.id);
      if (error) throw error;
    },
    onSuccess: (_, service) => {
      toast.success(service.active ? "Servicio desactivado." : "Servicio activado.");
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message || "No se pudo actualizar el servicio."),
  });

  const askDelete = async (service: ServiceRow) => {
    const { count, error } = await db
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("service_id", service.id);
    if (error) {
      toast.error(error.message || "No se pudo validar el uso del servicio.");
      return;
    }
    if ((count ?? 0) > 0) {
      toast.error("Este servicio ya tiene reservas. Podés desactivarlo en lugar de eliminarlo.");
    }
    setDeleteTarget({ kind: "service", item: service, usage: count ?? 0 });
  };

  const deleteService = useMutation({
    mutationFn: async (service: ServiceRow) => {
      const { error } = await db.from("services").delete().eq("id", service.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Servicio eliminado.");
      setDeleteTarget(null);
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message || "No se pudo eliminar el servicio."),
  });

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Servicios"
        description="Base de precio y duración usada por las reservas nuevas."
        actionLabel="Nuevo servicio"
        onCreate={() => setEditing("new")}
      />

      <ResourceState
        loading={services.isLoading}
        error={services.error as Error | null}
        empty={(services.data ?? []).length === 0}
        emptyText="No hay servicios configurados."
      >
        <ServicesTable
          services={services.data ?? []}
          onEdit={setEditing}
          onToggle={(s) => toggleActive.mutate(s)}
          onDelete={askDelete}
          togglingId={toggleActive.variables?.id}
          toggling={toggleActive.isPending}
        />
      </ResourceState>

      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <ServiceForm
            initial={editing === "new" ? null : editing}
            onClose={() => setEditing(null)}
            onSaved={() => {
              setEditing(null);
              invalidate();
            }}
          />
        </DialogContent>
      </Dialog>

      <DeleteDialog
        target={deleteTarget}
        busy={deleteService.isPending}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget?.kind === "service" && deleteTarget.usage === 0) {
            deleteService.mutate(deleteTarget.item);
          }
        }}
      />
    </div>
  );
}

function PricingItemsTab({ type }: { type: PricingType }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<PricingItemRow | "new" | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const label = type === "vehicle_surcharge" ? "recargo" : "extra";

  const query = useQuery({
    queryKey: ["admin", "precios", "pricing_items", type],
    queryFn: async () => {
      const { data, error } = await db
        .from("pricing_items")
        .select("*")
        .eq("type", type)
        .order("display_order", { ascending: true })
        .order("name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as PricingItemRow[];
    },
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["admin", "precios", "pricing_items"] });
    qc.invalidateQueries({ queryKey: ["pricing_items"] });
  };

  const toggleActive = useMutation({
    mutationFn: async (item: PricingItemRow) => {
      const { error } = await db
        .from("pricing_items")
        .update({ active: !item.active })
        .eq("id", item.id);
      if (error) throw error;
    },
    onSuccess: (_, item) => {
      toast.success(item.active ? "Ítem desactivado." : "Ítem activado.");
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message || "No se pudo actualizar el ítem."),
  });

  const askDelete = async (item: PricingItemRow) => {
    const { data, error } = await db
      .from("bookings")
      .select("id,service_id,service_name,vehicle_type,selected_extras,price_breakdown")
      .limit(5000);
    if (error) {
      toast.error(error.message || "No se pudo validar el uso del ítem.");
      return;
    }
    const usage = ((data ?? []) as BookingUsageRow[]).filter((booking) =>
      bookingUsesPricingItem(booking, item),
    ).length;
    if (usage > 0) {
      toast.error("Este ítem ya fue usado en reservas. Podés desactivarlo en lugar de eliminarlo.");
    }
    setDeleteTarget({ kind: "pricing", item, usage });
  };

  const deleteItem = useMutation({
    mutationFn: async (item: PricingItemRow) => {
      const { error } = await db.from("pricing_items").delete().eq("id", item.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Ítem eliminado.");
      setDeleteTarget(null);
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message || "No se pudo eliminar el ítem."),
  });

  return (
    <div className="space-y-4">
      <SectionHeader
        title={type === "vehicle_surcharge" ? "Recargos por vehículo" : "Extras"}
        description={
          type === "vehicle_surcharge"
            ? "Recargos que /reservar y booking-core aplican según el vehículo."
            : "Adicionales seleccionables en /reservar y validados por booking-core."
        }
        actionLabel={`Nuevo ${label}`}
        onCreate={() => setEditing("new")}
      />

      <ResourceState
        loading={query.isLoading}
        error={query.error as Error | null}
        empty={(query.data ?? []).length === 0}
        emptyText={`No hay ${type === "vehicle_surcharge" ? "recargos" : "extras"} configurados.`}
      >
        <PricingItemsTable
          items={query.data ?? []}
          onEdit={setEditing}
          onToggle={(item) => toggleActive.mutate(item)}
          onDelete={askDelete}
          togglingId={toggleActive.variables?.id}
          toggling={toggleActive.isPending}
        />
      </ResourceState>

      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <PricingItemForm
            type={type}
            initial={editing === "new" ? null : editing}
            onClose={() => setEditing(null)}
            onSaved={() => {
              setEditing(null);
              invalidate();
            }}
          />
        </DialogContent>
      </Dialog>

      <DeleteDialog
        target={deleteTarget}
        busy={deleteItem.isPending}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget?.kind === "pricing" && deleteTarget.usage === 0) {
            deleteItem.mutate(deleteTarget.item);
          }
        }}
      />
    </div>
  );
}

function SectionHeader({
  title,
  description,
  actionLabel,
  onCreate,
}: {
  title: string;
  description: string;
  actionLabel: string;
  onCreate: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <Button size="sm" onClick={onCreate}>
        <Plus className="h-4 w-4" /> {actionLabel}
      </Button>
    </div>
  );
}

function ResourceState({
  loading,
  error,
  empty,
  emptyText,
  children,
}: {
  loading: boolean;
  error: Error | null;
  empty: boolean;
  emptyText: string;
  children: React.ReactNode;
}) {
  if (loading) {
    return (
      <Card>
        <CardContent className="space-y-3 p-4">
          <Skeleton className="h-8 w-1/3" />
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }
  if (error) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-destructive">
          No pudimos cargar los datos: {error.message}
        </CardContent>
      </Card>
    );
  }
  if (empty) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">{emptyText}</CardContent>
      </Card>
    );
  }
  return <>{children}</>;
}

function ActiveBadge({ active }: { active: boolean }) {
  return <Badge variant={active ? "default" : "outline"}>{active ? "Activo" : "Inactivo"}</Badge>;
}

function RowActions({
  active,
  busy,
  onToggle,
  onEdit,
  onDelete,
}: {
  active: boolean;
  busy: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex justify-end gap-1">
      <Button size="sm" variant="ghost" onClick={onEdit}>
        <Pencil className="h-4 w-4" />
        <span className="sr-only">Editar</span>
      </Button>
      <Button size="sm" variant="ghost" disabled={busy} onClick={onToggle}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Power className="h-4 w-4" />}
        <span className="sr-only">{active ? "Desactivar" : "Activar"}</span>
      </Button>
      <Button size="sm" variant="ghost" onClick={onDelete}>
        <Trash2 className="h-4 w-4" />
        <span className="sr-only">Eliminar</span>
      </Button>
    </div>
  );
}

function ServicesTable({
  services,
  onEdit,
  onToggle,
  onDelete,
  togglingId,
  toggling,
}: {
  services: ServiceRow[];
  onEdit: (service: ServiceRow) => void;
  onToggle: (service: ServiceRow) => void;
  onDelete: (service: ServiceRow) => void;
  togglingId?: string;
  toggling: boolean;
}) {
  return (
    <>
      <Card className="hidden md:block">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead>Descripción</TableHead>
                <TableHead>Precio base</TableHead>
                <TableHead>Duración</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {services.map((service) => (
                <TableRow key={service.id}>
                  <TableCell className="font-medium">{service.name}</TableCell>
                  <TableCell className="max-w-sm text-sm text-muted-foreground">
                    {service.description || "—"}
                    <p className="mt-1 text-[11px]">{helperText(service.active, "service")}</p>
                  </TableCell>
                  <TableCell>{formatARS(service.base_price)}</TableCell>
                  <TableCell>{service.duration_minutes} min</TableCell>
                  <TableCell>
                    <ActiveBadge active={service.active} />
                  </TableCell>
                  <TableCell className="text-right">
                    <RowActions
                      active={service.active}
                      busy={toggling && togglingId === service.id}
                      onEdit={() => onEdit(service)}
                      onToggle={() => onToggle(service)}
                      onDelete={() => onDelete(service)}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="space-y-3 md:hidden">
        {services.map((service) => (
          <Card key={service.id}>
            <CardContent className="space-y-3 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium">{service.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {formatARS(service.base_price)} · {service.duration_minutes} min
                  </p>
                </div>
                <ActiveBadge active={service.active} />
              </div>
              {service.description && (
                <p className="text-sm text-muted-foreground">{service.description}</p>
              )}
              <p className="text-xs text-muted-foreground">
                {helperText(service.active, "service")}
              </p>
              <RowActions
                active={service.active}
                busy={toggling && togglingId === service.id}
                onEdit={() => onEdit(service)}
                onToggle={() => onToggle(service)}
                onDelete={() => onDelete(service)}
              />
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}

function PricingItemsTable({
  items,
  onEdit,
  onToggle,
  onDelete,
  togglingId,
  toggling,
}: {
  items: PricingItemRow[];
  onEdit: (item: PricingItemRow) => void;
  onToggle: (item: PricingItemRow) => void;
  onDelete: (item: PricingItemRow) => void;
  togglingId?: string;
  toggling: boolean;
}) {
  return (
    <>
      <Card className="hidden md:block">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Código</TableHead>
                <TableHead>Nombre</TableHead>
                <TableHead>Descripción</TableHead>
                <TableHead>Monto</TableHead>
                <TableHead>Minutos extra</TableHead>
                <TableHead>Orden</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-mono text-xs">{item.code}</TableCell>
                  <TableCell className="font-medium">{item.name}</TableCell>
                  <TableCell className="max-w-sm text-sm text-muted-foreground">
                    {item.description || "—"}
                    <p className="mt-1 text-[11px]">{helperText(item.active, "item")}</p>
                  </TableCell>
                  <TableCell>{formatARS(item.amount)}</TableCell>
                  <TableCell>{item.duration_minutes} min</TableCell>
                  <TableCell>{item.display_order}</TableCell>
                  <TableCell>
                    <ActiveBadge active={item.active} />
                  </TableCell>
                  <TableCell className="text-right">
                    <RowActions
                      active={item.active}
                      busy={toggling && togglingId === item.id}
                      onEdit={() => onEdit(item)}
                      onToggle={() => onToggle(item)}
                      onDelete={() => onDelete(item)}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="space-y-3 md:hidden">
        {items.map((item) => (
          <Card key={item.id}>
            <CardContent className="space-y-3 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium">{item.name}</p>
                  <p className="font-mono text-xs text-muted-foreground">{item.code}</p>
                </div>
                <ActiveBadge active={item.active} />
              </div>
              <p className="font-semibold">{formatARS(item.amount)} · {item.duration_minutes} min</p>
              {item.description && (
                <p className="text-sm text-muted-foreground">{item.description}</p>
              )}
              <p className="text-xs text-muted-foreground">{helperText(item.active, "item")}</p>
              <RowActions
                active={item.active}
                busy={toggling && togglingId === item.id}
                onEdit={() => onEdit(item)}
                onToggle={() => onToggle(item)}
                onDelete={() => onDelete(item)}
              />
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}

function ServiceForm({
  initial,
  onClose,
  onSaved,
}: {
  initial: ServiceRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [basePrice, setBasePrice] = useState(String(initial?.base_price ?? ""));
  const [duration, setDuration] = useState(String(initial?.duration_minutes ?? ""));
  const [active, setActive] = useState(initial?.active ?? true);

  const mutation = useMutation({
    mutationFn: async () => {
      const trimmedName = name.trim();
      const price = Number(basePrice);
      const minutes = Number(duration);

      if (!trimmedName) throw new Error("El nombre es obligatorio.");
      if (!Number.isFinite(price) || price < 0)
        throw new Error("El precio debe ser mayor o igual a 0.");
      if (!Number.isFinite(minutes) || minutes <= 0)
        throw new Error("La duración debe ser mayor a 0.");

      const payload = {
        name: trimmedName,
        description: description.trim() || null,
        base_price: Math.round(price),
        duration_minutes: Math.round(minutes),
        active,
      };

      if (initial) {
        const { error } = await db.from("services").update(payload).eq("id", initial.id);
        if (error) throw error;
        return "updated";
      }
      const { error } = await db.from("services").insert(payload);
      if (error) throw error;
      return "created";
    },
    onSuccess: (result) => {
      toast.success(result === "created" ? "Servicio creado." : "Servicio actualizado.");
      onSaved();
    },
    onError: (error: Error) => toast.error(error.message || "No se pudo guardar el servicio."),
  });

  const save = (event: FormEvent) => {
    event.preventDefault();
    mutation.mutate();
  };

  return (
    <form onSubmit={save} className="space-y-4">
      <DialogHeader>
        <DialogTitle>{initial ? "Editar servicio" : "Nuevo servicio"}</DialogTitle>
        <DialogDescription>
          Los cambios aplican solo a nuevas reservas. Las reservas existentes conservan su precio
          guardado.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-3">
        <div className="space-y-1">
          <Label htmlFor="service-name">Nombre *</Label>
          <Input
            id="service-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="service-description">Descripción</Label>
          <Textarea
            id="service-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            maxLength={500}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="service-price">Precio base (ARS) *</Label>
            <Input
              id="service-price"
              type="number"
              min={0}
              value={basePrice}
              onChange={(e) => setBasePrice(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="service-duration">Duración base (min) *</Label>
            <Input
              id="service-duration"
              type="number"
              min={1}
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
            />
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-md border p-3">
          <Switch checked={active} onCheckedChange={setActive} id="service-active" />
          <Label htmlFor="service-active">Activo para reservas nuevas</Label>
        </div>
      </div>

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancelar
        </Button>
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          Guardar
        </Button>
      </DialogFooter>
    </form>
  );
}

function PricingItemForm({
  type,
  initial,
  onClose,
  onSaved,
}: {
  type: PricingType;
  initial: PricingItemRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [code, setCode] = useState(initial?.code ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [amount, setAmount] = useState(String(initial?.amount ?? ""));
  const [duration, setDuration] = useState(String(initial?.duration_minutes ?? 0));
  const [displayOrder, setDisplayOrder] = useState(String(initial?.display_order ?? 0));
  const [active, setActive] = useState(initial?.active ?? true);

  const title = type === "vehicle_surcharge" ? "recargo por vehículo" : "extra";

  const mutation = useMutation({
    mutationFn: async () => {
      const trimmedCode = code.trim();
      const trimmedName = name.trim();
      const parsedAmount = Number(amount);
      const parsedDuration = Number(duration || 0);
      const parsedOrder = Number(displayOrder || 0);

      if (!trimmedCode) throw new Error("El código es obligatorio.");
      if (!CODE_RE.test(trimmedCode)) throw new Error("El código debe ser lowercase snake_case.");
      if (!trimmedName) throw new Error("El nombre es obligatorio.");
      if (!Number.isFinite(parsedAmount) || parsedAmount < 0)
        throw new Error("El monto debe ser mayor o igual a 0.");
      if (!Number.isFinite(parsedDuration) || parsedDuration < 0)
        throw new Error("Los minutos extra deben ser mayor o igual a 0.");
      if (!Number.isFinite(parsedOrder)) throw new Error("El orden debe ser numérico.");

      const payload = {
        type,
        code: trimmedCode,
        name: trimmedName,
        description: description.trim() || null,
        amount: Math.round(parsedAmount),
        duration_minutes: Math.round(parsedDuration),
        display_order: Math.round(parsedOrder),
        active,
      };

      if (initial) {
        const { error } = await db.from("pricing_items").update(payload).eq("id", initial.id);
        if (error) throw error;
        return "updated";
      }
      const { error } = await db.from("pricing_items").insert(payload);
      if (error) throw error;
      return "created";
    },
    onSuccess: (result) => {
      toast.success(result === "created" ? "Ítem creado." : "Ítem actualizado.");
      onSaved();
    },
    onError: (error: Error) => toast.error(error.message || "No se pudo guardar el ítem."),
  });

  const save = (event: FormEvent) => {
    event.preventDefault();
    mutation.mutate();
  };

  return (
    <form onSubmit={save} className="space-y-4">
      <DialogHeader>
        <DialogTitle>{initial ? `Editar ${title}` : `Nuevo ${title}`}</DialogTitle>
        <DialogDescription>
          El tipo queda fijo como <code>{type}</code> y lo consumen /reservar y booking-core.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="pricing-code">Código *</Label>
            <Input
              id="pricing-code"
              value={code}
              onChange={(e) => setCode(e.target.value.toLowerCase().replace(/\s+/g, "_"))}
              placeholder={type === "vehicle_surcharge" ? "pickup" : "encerado_rapido"}
              maxLength={80}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="pricing-name">Nombre *</Label>
            <Input
              id="pricing-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={140}
            />
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="pricing-description">Descripción</Label>
          <Textarea
            id="pricing-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            maxLength={500}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="pricing-amount">Monto (ARS) *</Label>
            <Input
              id="pricing-amount"
              type="number"
              min={0}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="pricing-duration">Minutos extra</Label>
            <Input
              id="pricing-duration"
              type="number"
              min={0}
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="pricing-order">Orden</Label>
            <Input
              id="pricing-order"
              type="number"
              value={displayOrder}
              onChange={(e) => setDisplayOrder(e.target.value)}
            />
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-md border p-3">
          <Switch checked={active} onCheckedChange={setActive} id="pricing-active" />
          <Label htmlFor="pricing-active">Activo para reservas nuevas</Label>
        </div>
      </div>

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancelar
        </Button>
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          Guardar
        </Button>
      </DialogFooter>
    </form>
  );
}

function DeleteDialog({
  target,
  busy,
  onClose,
  onConfirm,
}: {
  target: DeleteTarget | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const used = (target?.usage ?? 0) > 0;
  const name = target?.kind === "service" ? target.item.name : target?.item.name;
  const blockedMessage =
    target?.kind === "service"
      ? "Este servicio ya tiene reservas. Podés desactivarlo en lugar de eliminarlo."
      : "Este ítem ya fue usado en reservas. Podés desactivarlo en lugar de eliminarlo.";

  return (
    <AlertDialog open={!!target} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Eliminar {target?.kind === "service" ? "servicio" : "ítem"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {used ? (
              <>
                {blockedMessage} Uso detectado: <b>{target?.usage}</b> reserva(s).
              </>
            ) : (
              <>¿Eliminar “{name}”? Esta acción no se puede deshacer.</>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          {!used && (
            <AlertDialogAction onClick={onConfirm} disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Eliminar
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
