import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Loader2,
  Plus,
  Search,
  Phone,
  MapPin,
  Calendar as CalIcon,
  Clock,
  Car,
  StickyNote,
  CheckCircle2,
  PlayCircle,
  Flag,
  XCircle,
  AlertTriangle,
  Pencil,
} from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  BOOKING_STATUSES,
  PAYMENT_STATUSES,
  BOOKING_SOURCES,
  BookingStatusBadge,
  PaymentStatusBadge,
  BookingSourceBadge,
  bookingStatusLabels,
  paymentStatusLabels,
  bookingSourceLabels,
  formatPrice,
} from "@/lib/booking-badges";

export const Route = createFileRoute("/admin/reservas")({
  component: AdminReservas,
});

// ===========================================================================
// Types
// ===========================================================================

type Booking = {
  id: string;
  customer_id: string | null;
  customer_name: string;
  customer_phone: string;
  customer_email: string | null;
  address: string;
  neighborhood: string;
  vehicle_type: string;
  service_id: string | null;
  service_name: string;
  scheduled_date: string;
  scheduled_time: string;
  duration_minutes: number;
  payment_method: string;
  payment_status: string;
  booking_status: string;
  booking_source: string;
  price: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

type Service = {
  id: string;
  name: string;
  base_price: number;
  duration_minutes: number;
};

type ServiceArea = { id: string; name: string };

type AvailabilitySlot = {
  id: string;
  date: string;
  start_time: string;
  end_time: string;
  capacity: number;
  active: boolean;
};

type DateFilter = "all" | "today" | "tomorrow" | "week" | "future" | "past";

// ===========================================================================
// Helpers
// ===========================================================================

const todayIso = () => new Date().toISOString().slice(0, 10);
const addDaysIso = (d: number) => {
  const dt = new Date();
  dt.setDate(dt.getDate() + d);
  return dt.toISOString().slice(0, 10);
};

function fmtDate(d: string) {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
}
function fmtTime(t: string) {
  return t ? t.slice(0, 5) : "—";
}

async function upsertCustomerByPhone(b: {
  customer_phone: string;
  customer_name: string;
  customer_email?: string | null;
  address?: string | null;
  neighborhood?: string | null;
}) {
  const phone = b.customer_phone.trim();
  if (!phone) return null;
  const { data: existing } = await supabase
    .from("customers")
    .select("id")
    .eq("phone", phone)
    .maybeSingle();
  if (existing?.id) {
    await supabase
      .from("customers")
      .update({
        full_name: b.customer_name,
        email: b.customer_email ?? null,
        address: b.address ?? null,
        neighborhood: b.neighborhood ?? null,
      })
      .eq("id", existing.id);
    return existing.id;
  }
  const { data: created } = await supabase
    .from("customers")
    .insert({
      phone,
      full_name: b.customer_name,
      email: b.customer_email ?? null,
      address: b.address ?? null,
      neighborhood: b.neighborhood ?? null,
    })
    .select("id")
    .maybeSingle();
  return created?.id ?? null;
}

// ===========================================================================
// Page
// ===========================================================================

function AdminReservas() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [dateFilter, setDateFilter] = useState<DateFilter>("future");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [paymentFilter, setPaymentFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");

  const [selected, setSelected] = useState<Booking | null>(null);
  const [editing, setEditing] = useState<Booking | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState<Booking | null>(null);

  const bookingsQuery = useQuery({
    queryKey: ["admin", "bookings", { dateFilter, statusFilter, paymentFilter, sourceFilter }],
    queryFn: async () => {
      let q = supabase.from("bookings").select("*");

      const today = todayIso();
      if (dateFilter === "today") q = q.eq("scheduled_date", today);
      else if (dateFilter === "tomorrow") q = q.eq("scheduled_date", addDaysIso(1));
      else if (dateFilter === "week") q = q.gte("scheduled_date", today).lte("scheduled_date", addDaysIso(7));
      else if (dateFilter === "future") q = q.gte("scheduled_date", today);
      else if (dateFilter === "past") q = q.lt("scheduled_date", today);

      if (statusFilter !== "all") q = q.eq("booking_status", statusFilter);
      if (paymentFilter !== "all") q = q.eq("payment_status", paymentFilter);
      if (sourceFilter !== "all") q = q.eq("booking_source", sourceFilter);

      if (dateFilter === "all") q = q.order("created_at", { ascending: false }).limit(500);
      else
        q = q
          .order("scheduled_date", { ascending: true })
          .order("scheduled_time", { ascending: true })
          .limit(500);

      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Booking[];
    },
  });

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return bookingsQuery.data ?? [];
    return (bookingsQuery.data ?? []).filter((b) =>
      [b.customer_name, b.customer_phone, b.address, b.neighborhood]
        .filter(Boolean)
        .some((v) => v.toLowerCase().includes(term)),
    );
  }, [bookingsQuery.data, search]);

  const quickStatus = useMutation({
    mutationFn: async (input: { id: string; booking_status: string }) => {
      const { error } = await supabase
        .from("bookings")
        .update({ booking_status: input.booking_status })
        .eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      toast.success(`Estado actualizado a ${bookingStatusLabels[v.booking_status] ?? v.booking_status}`);
      qc.invalidateQueries({ queryKey: ["admin", "bookings"] });
      qc.invalidateQueries({ queryKey: ["admin", "metrics"] });
      setSelected((s) => (s && s.id === v.id ? { ...s, booking_status: v.booking_status } : s));
    },
    onError: () => toast.error("No pudimos actualizar la reserva."),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Reservas</h1>
          <p className="text-sm text-muted-foreground">
            Gestioná todas las reservas de Washero.
          </p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <Plus className="mr-1 h-4 w-4" /> Nueva reserva manual
        </Button>
      </div>

      <Card>
        <CardContent className="grid gap-3 p-4 md:grid-cols-5">
          <div className="md:col-span-2">
            <Label className="text-xs">Buscar</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Nombre, teléfono, dirección o barrio"
                className="pl-8"
              />
            </div>
          </div>
          <div>
            <Label className="text-xs">Fecha</Label>
            <Select value={dateFilter} onValueChange={(v) => setDateFilter(v as DateFilter)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="today">Hoy</SelectItem>
                <SelectItem value="tomorrow">Mañana</SelectItem>
                <SelectItem value="week">Esta semana</SelectItem>
                <SelectItem value="future">Próximas</SelectItem>
                <SelectItem value="past">Pasadas</SelectItem>
                <SelectItem value="all">Todas</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Estado</Label>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {BOOKING_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>{bookingStatusLabels[s]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Pago</Label>
            <Select value={paymentFilter} onValueChange={setPaymentFilter}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {PAYMENT_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>{paymentStatusLabels[s]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Origen</Label>
            <Select value={sourceFilter} onValueChange={setSourceFilter}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {BOOKING_SOURCES.map((s) => (
                  <SelectItem key={s} value={s}>{bookingSourceLabels[s]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {bookingsQuery.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : bookingsQuery.isError ? (
        <Card>
          <CardContent className="p-6 text-sm text-destructive">
            No pudimos cargar las reservas. Intentá nuevamente.
          </CardContent>
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center text-sm text-muted-foreground">
            No hay reservas con estos filtros.
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Mobile: cards */}
          <div className="grid gap-3 md:hidden">
            {filtered.map((b) => (
              <Card key={b.id} className="cursor-pointer" onClick={() => setSelected(b)}>
                <CardContent className="space-y-2 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{b.customer_name}</p>
                      <p className="truncate text-xs text-muted-foreground">{b.customer_phone}</p>
                    </div>
                    <BookingStatusBadge value={b.booking_status} />
                  </div>
                  <div className="text-sm">
                    <p>{b.service_name} · {b.vehicle_type}</p>
                    <p className="text-xs text-muted-foreground">{b.address}, {b.neighborhood}</p>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="inline-flex items-center gap-1">
                      <CalIcon className="h-3 w-3" /> {fmtDate(b.scheduled_date)} · {fmtTime(b.scheduled_time)}
                    </span>
                    <span className="font-medium">{formatPrice(b.price)}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <PaymentStatusBadge value={b.payment_status} />
                    <BookingSourceBadge value={b.booking_source} />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Desktop: table */}
          <Card className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Servicio</TableHead>
                  <TableHead>Ubicación</TableHead>
                  <TableHead>Fecha / Hora</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Pago</TableHead>
                  <TableHead>Origen</TableHead>
                  <TableHead className="text-right">Precio</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((b) => (
                  <TableRow
                    key={b.id}
                    className="cursor-pointer"
                    onClick={() => setSelected(b)}
                  >
                    <TableCell>
                      <div className="font-medium">{b.customer_name}</div>
                      <div className="text-xs text-muted-foreground">{b.customer_phone}</div>
                    </TableCell>
                    <TableCell>
                      <div>{b.service_name}</div>
                      <div className="text-xs text-muted-foreground">{b.vehicle_type}</div>
                    </TableCell>
                    <TableCell>
                      <div className="max-w-[220px] truncate">{b.address}</div>
                      <div className="text-xs text-muted-foreground">{b.neighborhood}</div>
                    </TableCell>
                    <TableCell>
                      <div>{fmtDate(b.scheduled_date)}</div>
                      <div className="text-xs text-muted-foreground">{fmtTime(b.scheduled_time)}</div>
                    </TableCell>
                    <TableCell><BookingStatusBadge value={b.booking_status} /></TableCell>
                    <TableCell><PaymentStatusBadge value={b.payment_status} /></TableCell>
                    <TableCell><BookingSourceBadge value={b.booking_source} /></TableCell>
                    <TableCell className="text-right font-medium">{formatPrice(b.price)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </>
      )}

      {/* Detail dialog */}
      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          {selected && (
            <BookingDetail
              booking={selected}
              onEdit={() => {
                setEditing(selected);
                setSelected(null);
              }}
              onCancel={() => setConfirmCancel(selected)}
              onQuickStatus={(s) =>
                quickStatus.mutate({ id: selected.id, booking_status: s })
              }
              busy={quickStatus.isPending}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          {editing && (
            <BookingEditForm
              booking={editing}
              onClose={() => setEditing(null)}
              onSaved={() => {
                qc.invalidateQueries({ queryKey: ["admin", "bookings"] });
                qc.invalidateQueries({ queryKey: ["admin", "metrics"] });
                setEditing(null);
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Create dialog */}
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <BookingCreateForm
            onClose={() => setCreating(false)}
            onCreated={() => {
              qc.invalidateQueries({ queryKey: ["admin", "bookings"] });
              qc.invalidateQueries({ queryKey: ["admin", "metrics"] });
              setCreating(false);
            }}
          />
        </DialogContent>
      </Dialog>

      {/* Cancel confirm */}
      <AlertDialog open={!!confirmCancel} onOpenChange={(o) => !o && setConfirmCancel(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Cancelar esta reserva?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción cambia el estado de la reserva a "Cancelada". Podés revertirlo
              después si fue un error.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Volver</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmCancel) {
                  quickStatus.mutate(
                    { id: confirmCancel.id, booking_status: "cancelled" },
                    {
                      onSettled: () => {
                        setConfirmCancel(null);
                        setSelected(null);
                      },
                    },
                  );
                }
              }}
            >
              Cancelar reserva
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ===========================================================================
// Detail
// ===========================================================================

function BookingDetail({
  booking,
  onEdit,
  onCancel,
  onQuickStatus,
  busy,
}: {
  booking: Booking;
  onEdit: () => void;
  onCancel: () => void;
  onQuickStatus: (s: string) => void;
  busy: boolean;
}) {
  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          {booking.customer_name}
          <BookingStatusBadge value={booking.booking_status} />
        </DialogTitle>
        <DialogDescription className="flex flex-wrap items-center gap-2">
          <PaymentStatusBadge value={booking.payment_status} />
          <BookingSourceBadge value={booking.booking_source} />
          <span className="text-xs">{booking.payment_method}</span>
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-4 py-2 text-sm sm:grid-cols-2">
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">Cliente</p>
          <p className="flex items-center gap-1.5"><Phone className="h-3.5 w-3.5" /> {booking.customer_phone}</p>
          {booking.customer_email && <p className="text-xs">{booking.customer_email}</p>}
        </div>
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">Servicio</p>
          <p className="flex items-center gap-1.5"><Car className="h-3.5 w-3.5" /> {booking.service_name} · {booking.vehicle_type}</p>
          <p className="text-xs text-muted-foreground">
            {booking.duration_minutes} min · {formatPrice(booking.price)}
          </p>
        </div>
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">Ubicación</p>
          <p className="flex items-start gap-1.5">
            <MapPin className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
            <span>{booking.address}, {booking.neighborhood}</span>
          </p>
        </div>
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">Programación</p>
          <p className="flex items-center gap-1.5"><CalIcon className="h-3.5 w-3.5" /> {fmtDate(booking.scheduled_date)}</p>
          <p className="flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" /> {fmtTime(booking.scheduled_time)}</p>
        </div>
        {booking.notes && (
          <div className="space-y-1 sm:col-span-2">
            <p className="text-xs font-medium text-muted-foreground">Notas</p>
            <p className="flex items-start gap-1.5">
              <StickyNote className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
              <span className="whitespace-pre-wrap">{booking.notes}</span>
            </p>
          </div>
        )}
        <div className="text-xs text-muted-foreground sm:col-span-2">
          Creada: {new Date(booking.created_at).toLocaleString("es-AR")} · Actualizada:{" "}
          {new Date(booking.updated_at).toLocaleString("es-AR")}
        </div>
      </div>

      <div className="space-y-2 border-t pt-3">
        <p className="text-xs font-medium text-muted-foreground">Acciones rápidas</p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={busy} onClick={() => onQuickStatus("confirmed")}>
            <CheckCircle2 className="mr-1 h-4 w-4" /> Confirmar
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => onQuickStatus("in_progress")}>
            <PlayCircle className="mr-1 h-4 w-4" /> Iniciar
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => onQuickStatus("completed")}>
            <CheckCircle2 className="mr-1 h-4 w-4" /> Completar
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => onQuickStatus("needs_review")}>
            <Flag className="mr-1 h-4 w-4" /> Revisar
          </Button>
          <Button size="sm" variant="destructive" disabled={busy} onClick={onCancel}>
            <XCircle className="mr-1 h-4 w-4" /> Cancelar
          </Button>
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onEdit}>
          <Pencil className="mr-1 h-4 w-4" /> Editar reserva
        </Button>
      </DialogFooter>
    </>
  );
}

// ===========================================================================
// Shared lookups
// ===========================================================================

function useLookups() {
  const services = useQuery({
    queryKey: ["lookup", "services"],
    queryFn: async (): Promise<Service[]> => {
      const { data, error } = await supabase
        .from("services")
        .select("id,name,base_price,duration_minutes")
        .eq("active", true)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
  const areas = useQuery({
    queryKey: ["lookup", "service_areas"],
    queryFn: async (): Promise<ServiceArea[]> => {
      const { data, error } = await supabase
        .from("service_areas")
        .select("id,name")
        .eq("active", true)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
  return { services, areas };
}

function useSlotsForDate(date: string) {
  return useQuery({
    queryKey: ["lookup", "slots", date],
    enabled: !!date,
    queryFn: async (): Promise<AvailabilitySlot[]> => {
      const { data, error } = await supabase
        .from("availability_slots")
        .select("id,date,start_time,end_time,capacity,active")
        .eq("date", date);
      if (error) throw error;
      return data ?? [];
    },
  });
}

// ===========================================================================
// Edit
// ===========================================================================

function BookingEditForm({
  booking,
  onClose,
  onSaved,
}: {
  booking: Booking;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { services, areas } = useLookups();
  const [form, setForm] = useState<Booking>(booking);
  const slots = useSlotsForDate(form.scheduled_date);

  const slotWarning = useMemo(() => {
    if (!slots.data) return null;
    const match = slots.data.find(
      (s) => s.start_time.slice(0, 5) === form.scheduled_time.slice(0, 5),
    );
    if (!match) return "No existe un slot configurado para este horario.";
    if (!match.active) return "Este slot está inactivo.";
    return null;
  }, [slots.data, form.scheduled_time]);

  const update = (patch: Partial<Booking>) => setForm((f) => ({ ...f, ...patch }));

  const onServiceChange = (id: string) => {
    const svc = services.data?.find((s) => s.id === id);
    if (!svc) return;
    update({
      service_id: svc.id,
      service_name: svc.name,
      price: svc.base_price,
      duration_minutes: svc.duration_minutes,
    });
  };

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("bookings")
        .update({
          customer_name: form.customer_name.trim(),
          customer_phone: form.customer_phone.trim(),
          customer_email: form.customer_email?.trim() || null,
          address: form.address.trim(),
          neighborhood: form.neighborhood.trim(),
          vehicle_type: form.vehicle_type.trim(),
          service_id: form.service_id,
          service_name: form.service_name,
          scheduled_date: form.scheduled_date,
          scheduled_time: form.scheduled_time,
          duration_minutes: form.duration_minutes,
          price: form.price,
          payment_method: form.payment_method,
          payment_status: form.payment_status,
          booking_status: form.booking_status,
          notes: form.notes?.trim() || null,
        })
        .eq("id", form.id);
      if (error) throw error;
      await upsertCustomerByPhone(form);
    },
    onSuccess: () => {
      toast.success("Reserva actualizada.");
      onSaved();
    },
    onError: () => toast.error("No pudimos guardar los cambios."),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Editar reserva</DialogTitle>
        <DialogDescription>Actualizá los datos de la reserva.</DialogDescription>
      </DialogHeader>
      <form onSubmit={submit} className="space-y-4">
        <BookingFormFields
          form={form}
          update={update}
          services={services.data ?? []}
          areas={areas.data ?? []}
          slots={slots.data ?? []}
          slotWarning={slotWarning}
          onServiceChange={onServiceChange}
        />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Volver
          </Button>
          <Button type="submit" disabled={save.isPending}>
            {save.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            Guardar cambios
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}

// ===========================================================================
// Create
// ===========================================================================

function BookingCreateForm({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const { services, areas } = useLookups();
  const [form, setForm] = useState<Booking>({
    id: "",
    customer_id: null,
    customer_name: "",
    customer_phone: "",
    customer_email: "",
    address: "",
    neighborhood: "",
    vehicle_type: "Auto",
    service_id: null,
    service_name: "",
    scheduled_date: todayIso(),
    scheduled_time: "10:00",
    duration_minutes: 60,
    payment_method: "Pagar después",
    payment_status: "pending",
    booking_status: "confirmed",
    booking_source: "admin",
    price: 0,
    notes: "",
    created_at: "",
    updated_at: "",
  });
  const slots = useSlotsForDate(form.scheduled_date);

  const slotWarning = useMemo(() => {
    if (!slots.data) return null;
    const match = slots.data.find(
      (s) => s.start_time.slice(0, 5) === form.scheduled_time.slice(0, 5),
    );
    if (!match) return "No existe un slot configurado para este horario.";
    if (!match.active) return "Este slot está inactivo.";
    return null;
  }, [slots.data, form.scheduled_time]);

  const update = (patch: Partial<Booking>) => setForm((f) => ({ ...f, ...patch }));

  const onServiceChange = (id: string) => {
    const svc = services.data?.find((s) => s.id === id);
    if (!svc) return;
    update({
      service_id: svc.id,
      service_name: svc.name,
      price: svc.base_price,
      duration_minutes: svc.duration_minutes,
    });
  };

  const create = useMutation({
    mutationFn: async () => {
      if (!form.service_id) throw new Error("Elegí un servicio.");
      if (!form.customer_name.trim() || !form.customer_phone.trim() || !form.address.trim() || !form.neighborhood.trim()) {
        throw new Error("Completá los datos obligatorios.");
      }
      const customerId = await upsertCustomerByPhone(form);
      const { error } = await supabase.from("bookings").insert({
        customer_id: customerId,
        customer_name: form.customer_name.trim(),
        customer_phone: form.customer_phone.trim(),
        customer_email: form.customer_email?.trim() || null,
        address: form.address.trim(),
        neighborhood: form.neighborhood.trim(),
        vehicle_type: form.vehicle_type.trim(),
        service_id: form.service_id,
        service_name: form.service_name,
        scheduled_date: form.scheduled_date,
        scheduled_time: form.scheduled_time,
        duration_minutes: form.duration_minutes,
        price: form.price,
        payment_method: form.payment_method,
        payment_status: form.payment_status,
        booking_status: form.booking_status,
        booking_source: "admin",
        notes: form.notes?.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Reserva creada.");
      onCreated();
    },
    onError: (e: Error) => toast.error(e.message || "No pudimos crear la reserva."),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Nueva reserva manual</DialogTitle>
        <DialogDescription>Cargá manualmente una reserva del lado del admin.</DialogDescription>
      </DialogHeader>
      <form onSubmit={submit} className="space-y-4">
        <BookingFormFields
          form={form}
          update={update}
          services={services.data ?? []}
          areas={areas.data ?? []}
          slots={slots.data ?? []}
          slotWarning={slotWarning}
          onServiceChange={onServiceChange}
        />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={create.isPending}>
            {create.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            Crear reserva
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}

// ===========================================================================
// Shared form fields
// ===========================================================================

function BookingFormFields({
  form,
  update,
  services,
  areas,
  slots,
  slotWarning,
  onServiceChange,
}: {
  form: Booking;
  update: (p: Partial<Booking>) => void;
  services: Service[];
  areas: ServiceArea[];
  slots: AvailabilitySlot[];
  slotWarning: string | null;
  onServiceChange: (id: string) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Nombre">
        <Input value={form.customer_name} onChange={(e) => update({ customer_name: e.target.value })} required />
      </Field>
      <Field label="Teléfono">
        <Input value={form.customer_phone} onChange={(e) => update({ customer_phone: e.target.value })} required />
      </Field>
      <Field label="Email" className="sm:col-span-2">
        <Input
          type="email"
          value={form.customer_email ?? ""}
          onChange={(e) => update({ customer_email: e.target.value })}
        />
      </Field>
      <Field label="Dirección" className="sm:col-span-2">
        <Input value={form.address} onChange={(e) => update({ address: e.target.value })} required />
      </Field>
      <Field label="Barrio / zona">
        <Select value={form.neighborhood} onValueChange={(v) => update({ neighborhood: v })}>
          <SelectTrigger><SelectValue placeholder="Elegí una zona" /></SelectTrigger>
          <SelectContent>
            {areas.map((a) => (
              <SelectItem key={a.id} value={a.name}>{a.name}</SelectItem>
            ))}
            {form.neighborhood && !areas.find((a) => a.name === form.neighborhood) && (
              <SelectItem value={form.neighborhood}>{form.neighborhood} (fuera de zona)</SelectItem>
            )}
          </SelectContent>
        </Select>
      </Field>
      <Field label="Tipo de vehículo">
        <Select value={form.vehicle_type} onValueChange={(v) => update({ vehicle_type: v })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {["Auto", "SUV", "Camioneta", "Moto"].map((v) => (
              <SelectItem key={v} value={v}>{v}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label="Servicio" className="sm:col-span-2">
        <Select value={form.service_id ?? ""} onValueChange={onServiceChange}>
          <SelectTrigger><SelectValue placeholder="Elegí un servicio" /></SelectTrigger>
          <SelectContent>
            {services.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name} · {formatPrice(s.base_price)} · {s.duration_minutes} min
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label="Fecha">
        <Input
          type="date"
          value={form.scheduled_date}
          onChange={(e) => update({ scheduled_date: e.target.value })}
          required
        />
      </Field>
      <Field label="Hora">
        <Select
          value={form.scheduled_time.slice(0, 5)}
          onValueChange={(v) => update({ scheduled_time: `${v}:00` })}
        >
          <SelectTrigger><SelectValue placeholder="Elegí un horario" /></SelectTrigger>
          <SelectContent>
            {slots.length === 0 ? (
              <SelectItem value={form.scheduled_time.slice(0, 5)}>
                {form.scheduled_time.slice(0, 5)}
              </SelectItem>
            ) : (
              slots.map((s) => {
                const t = s.start_time.slice(0, 5);
                return (
                  <SelectItem key={s.id} value={t}>
                    {t} {s.active ? "" : "(inactivo)"}
                  </SelectItem>
                );
              })
            )}
          </SelectContent>
        </Select>
      </Field>
      {slotWarning && (
        <div className="sm:col-span-2 flex items-start gap-1.5 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" /> {slotWarning}
        </div>
      )}
      <Field label="Duración (min)">
        <Input
          type="number"
          min={15}
          step={15}
          value={form.duration_minutes}
          onChange={(e) => update({ duration_minutes: Number(e.target.value) })}
        />
      </Field>
      <Field label="Precio">
        <Input
          type="number"
          min={0}
          value={form.price}
          onChange={(e) => update({ price: Number(e.target.value) })}
        />
      </Field>
      <Field label="Método de pago">
        <Select value={form.payment_method} onValueChange={(v) => update({ payment_method: v })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {["Pagar después", "Efectivo", "Transferencia", "Mercado Pago"].map((v) => (
              <SelectItem key={v} value={v}>{v}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label="Estado del pago">
        <Select value={form.payment_status} onValueChange={(v) => update({ payment_status: v })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {PAYMENT_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>{paymentStatusLabels[s]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label="Estado de la reserva">
        <Select value={form.booking_status} onValueChange={(v) => update({ booking_status: v })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {BOOKING_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>{bookingStatusLabels[s]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label="Notas" className="sm:col-span-2">
        <Textarea
          rows={3}
          value={form.notes ?? ""}
          onChange={(e) => update({ notes: e.target.value })}
        />
      </Field>
    </div>
  );
}

function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`space-y-1 ${className ?? ""}`}>
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}
