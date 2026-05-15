import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import {
  CalendarPlus,
  Layers,
  Lock,
  RefreshCw,
  Pencil,
  Trash2,
  AlertTriangle,
  Loader2,
} from "lucide-react";

export const Route = createFileRoute("/admin/disponibilidad")({
  component: DisponibilidadPage,
});

// ---------- types ----------
type Slot = {
  id: string;
  date: string; // yyyy-mm-dd
  start_time: string; // HH:MM:SS
  end_time: string;
  capacity: number;
  active: boolean;
  created_at: string;
  updated_at: string;
};

type RangePreset = "today" | "7" | "14" | "month" | "custom";
type StatusFilter = "all" | "active" | "inactive";
type CapFilter = "all" | "available" | "full";

// ---------- helpers ----------
const WEEKDAY_NAMES = [
  "Domingo",
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
  "Sábado",
];

function todayISO() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return toISODate(d);
}
function toISODate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function addDays(iso: string, n: number) {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return toISODate(d);
}
function endOfMonth(iso: string) {
  const d = new Date(iso + "T00:00:00");
  return toISODate(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}
function startOfMonth(iso: string) {
  const d = new Date(iso + "T00:00:00");
  return toISODate(new Date(d.getFullYear(), d.getMonth(), 1));
}
function fmtDate(iso: string) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}
function dayName(iso: string) {
  const d = new Date(iso + "T00:00:00");
  return WEEKDAY_NAMES[d.getDay()];
}
function hhmm(t: string) {
  return t?.slice(0, 5) ?? "";
}
function toTimeStr(t: string) {
  // ensure HH:MM:SS
  if (!t) return t;
  return t.length === 5 ? `${t}:00` : t;
}
function addMinutesToTime(time: string, mins: number) {
  const [h, m] = time.split(":").map(Number);
  const total = h * 60 + m + mins;
  const hh = String(Math.floor(total / 60) % 24).padStart(2, "0");
  const mm = String(total % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

// ---------- main ----------
function DisponibilidadPage() {
  const qc = useQueryClient();
  const [range, setRange] = useState<RangePreset>("14");
  const [customFrom, setCustomFrom] = useState(todayISO());
  const [customTo, setCustomTo] = useState(addDays(todayISO(), 14));
  const [status, setStatus] = useState<StatusFilter>("all");
  const [cap, setCap] = useState<CapFilter>("all");
  const [search, setSearch] = useState("");

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Slot | null>(null);
  const [deleting, setDeleting] = useState<Slot | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [blockOpen, setBlockOpen] = useState(false);

  const [from, to] = useMemo(() => {
    const today = todayISO();
    if (range === "today") return [today, today];
    if (range === "7") return [today, addDays(today, 7)];
    if (range === "14") return [today, addDays(today, 14)];
    if (range === "month") return [startOfMonth(today), endOfMonth(today)];
    return [customFrom, customTo];
  }, [range, customFrom, customTo]);

  const slotsQuery = useQuery({
    queryKey: ["availability_slots", from, to],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("availability_slots")
        .select("*")
        .gte("date", from)
        .lte("date", to)
        .order("date", { ascending: true })
        .order("start_time", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Slot[];
    },
  });

  const bookingsQuery = useQuery({
    queryKey: ["availability_bookings", from, to],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bookings")
        .select("scheduled_date, scheduled_time, booking_status")
        .gte("scheduled_date", from)
        .lte("scheduled_date", to)
        .neq("booking_status", "cancelled");
      if (error) throw error;
      return (data ?? []) as {
        scheduled_date: string;
        scheduled_time: string;
        booking_status: string;
      }[];
    },
  });

  // booking count per (date|HH:MM)
  const bookingsMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const b of bookingsQuery.data ?? []) {
      const key = `${b.scheduled_date}|${hhmm(b.scheduled_time)}`;
      m.set(key, (m.get(key) ?? 0) + 1);
    }
    return m;
  }, [bookingsQuery.data]);

  const bookingsForSlot = (s: Slot) =>
    bookingsMap.get(`${s.date}|${hhmm(s.start_time)}`) ?? 0;
  const bookingsForDate = (date: string) => {
    let n = 0;
    for (const [k, v] of bookingsMap) if (k.startsWith(date + "|")) n += v;
    return n;
  };

  const filtered = useMemo(() => {
    const list = (slotsQuery.data ?? []).filter((s) => {
      if (status === "active" && !s.active) return false;
      if (status === "inactive" && s.active) return false;
      const used = bookingsForSlot(s);
      const remaining = s.capacity - used;
      if (cap === "available" && !(s.active && remaining > 0)) return false;
      if (cap === "full" && remaining > 0) return false;
      if (search) {
        const q = search.toLowerCase();
        if (
          !s.date.includes(q) &&
          !hhmm(s.start_time).includes(q) &&
          !hhmm(s.end_time).includes(q)
        )
          return false;
      }
      return true;
    });
    return list;
  }, [slotsQuery.data, status, cap, search, bookingsMap]);

  const grouped = useMemo(() => {
    const map = new Map<string, Slot[]>();
    for (const s of filtered) {
      const arr = map.get(s.date) ?? [];
      arr.push(s);
      map.set(s.date, arr);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  const refreshAll = () => {
    qc.invalidateQueries({ queryKey: ["availability_slots"] });
    qc.invalidateQueries({ queryKey: ["availability_bookings"] });
  };

  const toggleActive = async (s: Slot) => {
    const used = bookingsForSlot(s);
    if (s.active && used > 0) {
      const ok = window.confirm(
        `Este horario tiene ${used} reserva(s) existentes. Desactivarlo no cancela las reservas ya creadas. ¿Continuar?`,
      );
      if (!ok) return;
    }
    const { error } = await supabase
      .from("availability_slots")
      .update({ active: !s.active })
      .eq("id", s.id);
    if (error) {
      toast.error("No se pudo actualizar", { description: error.message });
      return;
    }
    toast.success(s.active ? "Horario desactivado" : "Horario activado");
    refreshAll();
  };

  const loading = slotsQuery.isLoading || bookingsQuery.isLoading;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Disponibilidad</h1>
          <p className="text-sm text-muted-foreground">
            Gestioná los días, horarios y capacidad disponibles para recibir reservas.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setCreating(true)}>
            <CalendarPlus className="mr-2 h-4 w-4" /> Crear horario
          </Button>
          <Button variant="secondary" onClick={() => setBulkOpen(true)}>
            <Layers className="mr-2 h-4 w-4" /> Generar horarios
          </Button>
          <Button variant="secondary" onClick={() => setBlockOpen(true)}>
            <Lock className="mr-2 h-4 w-4" /> Bloquear día
          </Button>
          <Button variant="outline" onClick={refreshAll}>
            <RefreshCw className="mr-2 h-4 w-4" /> Actualizar
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <Label className="text-xs">Rango</Label>
            <Select value={range} onValueChange={(v) => setRange(v as RangePreset)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="today">Hoy</SelectItem>
                <SelectItem value="7">Próximos 7 días</SelectItem>
                <SelectItem value="14">Próximos 14 días</SelectItem>
                <SelectItem value="month">Este mes</SelectItem>
                <SelectItem value="custom">Personalizado</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {range === "custom" && (
            <>
              <div>
                <Label className="text-xs">Desde</Label>
                <Input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Hasta</Label>
                <Input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
              </div>
            </>
          )}
          <div>
            <Label className="text-xs">Estado</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="active">Activos</SelectItem>
                <SelectItem value="inactive">Inactivos</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Cupo</Label>
            <Select value={cap} onValueChange={(v) => setCap(v as CapFilter)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="available">Con cupo</SelectItem>
                <SelectItem value="full">Llenos</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Buscar</Label>
            <Input placeholder="fecha u hora" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center p-10 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Cargando...
        </div>
      ) : grouped.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center text-muted-foreground">
            No hay horarios para el rango seleccionado.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {grouped.map(([date, slots]) => {
            const activeCount = slots.filter((s) => s.active).length;
            const inactiveCount = slots.length - activeCount;
            const bookings = bookingsForDate(date);
            return (
              <Card key={date}>
                <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-3">
                  <div>
                    <CardTitle className="text-base">
                      {dayName(date)} — {fmtDate(date)}
                    </CardTitle>
                    <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                      <Badge variant="secondary">{activeCount} activos</Badge>
                      {inactiveCount > 0 && <Badge variant="outline">{inactiveCount} inactivos</Badge>}
                      <Badge variant="outline">{bookings} reservas</Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  {/* Desktop */}
                  <div className="hidden md:block">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Inicio</TableHead>
                          <TableHead>Fin</TableHead>
                          <TableHead>Capacidad</TableHead>
                          <TableHead>Reservas</TableHead>
                          <TableHead>Restante</TableHead>
                          <TableHead>Estado</TableHead>
                          <TableHead className="text-right">Acciones</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {slots.map((s) => {
                          const used = bookingsForSlot(s);
                          const remaining = s.capacity - used;
                          return (
                            <TableRow key={s.id}>
                              <TableCell className="font-medium">{hhmm(s.start_time)}</TableCell>
                              <TableCell>{hhmm(s.end_time)}</TableCell>
                              <TableCell>{s.capacity}</TableCell>
                              <TableCell>
                                {used > 0 ? (
                                  <Badge variant="secondary" className="gap-1">
                                    <AlertTriangle className="h-3 w-3" /> {used}
                                  </Badge>
                                ) : (
                                  0
                                )}
                              </TableCell>
                              <TableCell>{Math.max(remaining, 0)}</TableCell>
                              <TableCell>
                                {!s.active ? (
                                  <Badge variant="outline">Inactivo</Badge>
                                ) : remaining <= 0 ? (
                                  <Badge variant="destructive">Lleno</Badge>
                                ) : (
                                  <Badge>Disponible</Badge>
                                )}
                              </TableCell>
                              <TableCell className="text-right">
                                <div className="flex justify-end gap-1">
                                  <Button size="sm" variant="ghost" onClick={() => setEditing(s)}>
                                    <Pencil className="h-4 w-4" />
                                  </Button>
                                  <Button size="sm" variant="ghost" onClick={() => toggleActive(s)}>
                                    {s.active ? "Desactivar" : "Activar"}
                                  </Button>
                                  <Button size="sm" variant="ghost" onClick={() => setDeleting(s)}>
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                  {/* Mobile */}
                  <div className="space-y-2 p-3 md:hidden">
                    {slots.map((s) => {
                      const used = bookingsForSlot(s);
                      const remaining = s.capacity - used;
                      return (
                        <div key={s.id} className="rounded-lg border p-3">
                          <div className="flex items-center justify-between">
                            <div className="font-medium">
                              {hhmm(s.start_time)} – {hhmm(s.end_time)}
                            </div>
                            {!s.active ? (
                              <Badge variant="outline">Inactivo</Badge>
                            ) : remaining <= 0 ? (
                              <Badge variant="destructive">Lleno</Badge>
                            ) : (
                              <Badge>Disponible</Badge>
                            )}
                          </div>
                          <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                            <div>Cap: {s.capacity}</div>
                            <div>Reservas: {used}</div>
                            <div>Restante: {Math.max(remaining, 0)}</div>
                          </div>
                          {used > 0 && (
                            <div className="mt-2 flex items-center gap-1 text-xs text-amber-600">
                              <AlertTriangle className="h-3 w-3" /> Tiene reservas
                            </div>
                          )}
                          <div className="mt-3 flex flex-wrap gap-2">
                            <Button size="sm" variant="outline" onClick={() => setEditing(s)}>
                              <Pencil className="mr-1 h-3 w-3" /> Editar
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => toggleActive(s)}>
                              {s.active ? "Desactivar" : "Activar"}
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => setDeleting(s)}>
                              <Trash2 className="mr-1 h-3 w-3" /> Eliminar
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Dialogs */}
      <SlotFormDialog
        open={creating}
        onOpenChange={setCreating}
        onSaved={refreshAll}
      />
      <SlotFormDialog
        open={!!editing}
        slot={editing}
        existingBookings={editing ? bookingsForSlot(editing) : 0}
        onOpenChange={(o) => !o && setEditing(null)}
        onSaved={refreshAll}
      />
      <DeleteSlotDialog
        slot={deleting}
        bookings={deleting ? bookingsForSlot(deleting) : 0}
        onOpenChange={(o) => !o && setDeleting(null)}
        onDeleted={refreshAll}
      />
      <BulkGenerateDialog open={bulkOpen} onOpenChange={setBulkOpen} onSaved={refreshAll} />
      <BlockDayDialog open={blockOpen} onOpenChange={setBlockOpen} onSaved={refreshAll} />
    </div>
  );
}

// ---------- create/edit dialog ----------
function SlotFormDialog({
  open,
  onOpenChange,
  onSaved,
  slot,
  existingBookings = 0,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
  slot?: Slot | null;
  existingBookings?: number;
}) {
  const isEdit = !!slot;
  const [date, setDate] = useState(slot?.date ?? todayISO());
  const [startTime, setStartTime] = useState(hhmm(slot?.start_time ?? "09:00"));
  const [endTime, setEndTime] = useState(hhmm(slot?.end_time ?? "10:30"));
  const [capacity, setCapacity] = useState<number>(slot?.capacity ?? 1);
  const [active, setActive] = useState<boolean>(slot?.active ?? true);
  const [saving, setSaving] = useState(false);

  // reset when slot changes
  useMemo(() => {
    if (open) {
      setDate(slot?.date ?? todayISO());
      setStartTime(hhmm(slot?.start_time ?? "09:00"));
      setEndTime(hhmm(slot?.end_time ?? "10:30"));
      setCapacity(slot?.capacity ?? 1);
      setActive(slot?.active ?? true);
    }
  }, [open, slot]);

  const submit = async () => {
    if (!date || !startTime || !endTime) {
      toast.error("Completá todos los campos");
      return;
    }
    if (endTime <= startTime) {
      toast.error("La hora de fin debe ser mayor a la de inicio");
      return;
    }
    if (capacity < 1) {
      toast.error("La capacidad debe ser al menos 1");
      return;
    }
    if (isEdit && capacity < existingBookings) {
      const ok = window.confirm(
        `Este horario ya tiene ${existingBookings} reserva(s). Reducir la capacidad a ${capacity} puede sobrepasar el cupo. ¿Continuar?`,
      );
      if (!ok) return;
    }
    setSaving(true);
    try {
      if (isEdit && slot) {
        const { error } = await supabase
          .from("availability_slots")
          .update({
            date,
            start_time: toTimeStr(startTime),
            end_time: toTimeStr(endTime),
            capacity,
            active,
          })
          .eq("id", slot.id);
        if (error) throw error;
        toast.success("Horario actualizado");
      } else {
        // duplicate check
        const { data: dup } = await supabase
          .from("availability_slots")
          .select("id")
          .eq("date", date)
          .eq("start_time", toTimeStr(startTime))
          .maybeSingle();
        if (dup) {
          toast.error("Ya existe un horario con esa fecha y hora de inicio");
          setSaving(false);
          return;
        }
        const { error } = await supabase.from("availability_slots").insert({
          date,
          start_time: toTimeStr(startTime),
          end_time: toTimeStr(endTime),
          capacity,
          active,
        });
        if (error) throw error;
        toast.success("Horario creado");
      }
      onSaved();
      onOpenChange(false);
    } catch (e: any) {
      toast.error("No se pudo guardar", { description: e.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar horario" : "Crear horario"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Modificá los datos del horario."
              : "Definí fecha, horario y capacidad."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div>
            <Label>Fecha</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Inicio</Label>
              <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            </div>
            <div>
              <Label>Fin</Label>
              <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
            </div>
          </div>
          <div>
            <Label>Capacidad</Label>
            <Input
              type="number"
              min={1}
              value={capacity}
              onChange={(e) => setCapacity(Number(e.target.value))}
            />
          </div>
          <div className="flex items-center justify-between rounded border p-3">
            <div>
              <div className="text-sm font-medium">Activo</div>
              <div className="text-xs text-muted-foreground">
                Solo los horarios activos se ofrecen al público.
              </div>
            </div>
            <Switch checked={active} onCheckedChange={setActive} />
          </div>
          {isEdit && existingBookings > 0 && (
            <div className="flex items-start gap-2 rounded border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800">
              <AlertTriangle className="mt-0.5 h-4 w-4" />
              <div>
                Este horario tiene {existingBookings} reserva(s). Tené cuidado al reducir capacidad o desactivarlo.
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------- delete ----------
function DeleteSlotDialog({
  slot,
  bookings,
  onOpenChange,
  onDeleted,
}: {
  slot: Slot | null;
  bookings: number;
  onOpenChange: (v: boolean) => void;
  onDeleted: () => void;
}) {
  const open = !!slot;
  const [confirmText, setConfirmText] = useState("");
  const requiresStrong = bookings > 0;

  const onConfirm = async () => {
    if (!slot) return;
    if (requiresStrong && confirmText.trim().toLowerCase() !== "eliminar") {
      toast.error("Escribí 'eliminar' para confirmar");
      return;
    }
    const { error } = await supabase.from("availability_slots").delete().eq("id", slot.id);
    if (error) {
      toast.error("No se pudo eliminar", { description: error.message });
      return;
    }
    toast.success("Horario eliminado");
    onDeleted();
    onOpenChange(false);
    setConfirmText("");
  };

  return (
    <AlertDialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setConfirmText(""); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Eliminar horario</AlertDialogTitle>
          <AlertDialogDescription>
            {requiresStrong ? (
              <>
                Este horario tiene <b>{bookings}</b> reserva(s) asociadas. Eliminarlo no eliminará las reservas, pero puede generar inconsistencias. Te recomendamos desactivarlo en lugar de eliminarlo.
                <div className="mt-3">
                  Escribí <b>eliminar</b> para confirmar:
                </div>
              </>
            ) : (
              "¿Confirmás que querés eliminar este horario?"
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {requiresStrong && (
          <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder="eliminar" />
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Eliminar</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ---------- bulk generate ----------
const WEEKDAYS = [
  { v: 1, l: "Lun" },
  { v: 2, l: "Mar" },
  { v: 3, l: "Mié" },
  { v: 4, l: "Jue" },
  { v: 5, l: "Vie" },
  { v: 6, l: "Sáb" },
  { v: 0, l: "Dom" },
];

function BulkGenerateDialog({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
}) {
  const [startDate, setStartDate] = useState(todayISO());
  const [endDate, setEndDate] = useState(addDays(todayISO(), 14));
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5, 6]);
  const [dayStart, setDayStart] = useState("09:00");
  const [dayEnd, setDayEnd] = useState("18:00");
  const [duration, setDuration] = useState(90);
  const [interval, setInterval] = useState(90);
  const [allowOverlap, setAllowOverlap] = useState(false);
  const [capacity, setCapacity] = useState(1);
  const [active, setActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<{ created: number; skipped: number } | null>(null);

  const effectiveInterval = allowOverlap ? interval : duration;

  const toggleWd = (v: number) =>
    setWeekdays((s) => (s.includes(v) ? s.filter((x) => x !== v) : [...s, v]));

  const generateCandidates = () => {
    const out: { date: string; start_time: string; end_time: string }[] = [];
    if (!startDate || !endDate || endDate < startDate) return out;
    let cur = startDate;
    while (cur <= endDate) {
      const d = new Date(cur + "T00:00:00");
      if (weekdays.includes(d.getDay())) {
        let t = dayStart;
        while (true) {
          const end = addMinutesToTime(t, duration);
          if (end > dayEnd) break;
          out.push({ date: cur, start_time: toTimeStr(t), end_time: toTimeStr(end) });
          const next = addMinutesToTime(t, effectiveInterval);
          if (next <= t) break;
          t = next;
          if (t >= dayEnd) break;
        }
      }
      cur = addDays(cur, 1);
    }
    return out;
  };

  const doPreview = async () => {
    const cand = generateCandidates();
    if (!cand.length) {
      setPreview({ created: 0, skipped: 0 });
      return;
    }
    const { data: existing } = await supabase
      .from("availability_slots")
      .select("date, start_time")
      .gte("date", startDate)
      .lte("date", endDate);
    const existSet = new Set(
      (existing ?? []).map((e: any) => `${e.date}|${e.start_time}`),
    );
    let skipped = 0;
    for (const c of cand) if (existSet.has(`${c.date}|${c.start_time}`)) skipped++;
    setPreview({ created: cand.length - skipped, skipped });
  };

  const submit = async () => {
    setSaving(true);
    try {
      const cand = generateCandidates();
      if (!cand.length) {
        toast.error("No hay horarios para generar");
        return;
      }
      const { data: existing } = await supabase
        .from("availability_slots")
        .select("date, start_time")
        .gte("date", startDate)
        .lte("date", endDate);
      const existSet = new Set(
        (existing ?? []).map((e: any) => `${e.date}|${e.start_time}`),
      );
      const rows = cand
        .filter((c) => !existSet.has(`${c.date}|${c.start_time}`))
        .map((c) => ({ ...c, capacity, active }));
      if (!rows.length) {
        toast.info("Todos los horarios ya existían");
        onOpenChange(false);
        return;
      }
      const { error } = await supabase.from("availability_slots").insert(rows);
      if (error) throw error;
      toast.success(`Se crearon ${rows.length} horarios`, {
        description: `Omitidos: ${cand.length - rows.length}`,
      });
      onSaved();
      onOpenChange(false);
      setPreview(null);
    } catch (e: any) {
      toast.error("Error al generar", { description: e.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setPreview(null); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Generar horarios</DialogTitle>
          <DialogDescription>
            Creá múltiples horarios automáticamente para un rango de fechas.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Desde</Label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div>
              <Label>Hasta</Label>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
          </div>
          <div>
            <Label>Días de la semana</Label>
            <div className="mt-1 flex flex-wrap gap-2">
              {WEEKDAYS.map((w) => (
                <label key={w.v} className="flex items-center gap-1 rounded border px-2 py-1 text-sm">
                  <Checkbox checked={weekdays.includes(w.v)} onCheckedChange={() => toggleWd(w.v)} />
                  {w.l}
                </label>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Apertura</Label>
              <Input type="time" value={dayStart} onChange={(e) => setDayStart(e.target.value)} />
            </div>
            <div>
              <Label>Cierre</Label>
              <Input type="time" value={dayEnd} onChange={(e) => setDayEnd(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Intervalo (min)</Label>
              <Select value={String(interval)} onValueChange={(v) => setInterval(Number(v))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="60">60</SelectItem>
                  <SelectItem value="90">90</SelectItem>
                  <SelectItem value="120">120</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Duración (min)</Label>
              <Select value={String(duration)} onValueChange={(v) => setDuration(Number(v))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="60">60</SelectItem>
                  <SelectItem value="90">90</SelectItem>
                  <SelectItem value="120">120</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Capacidad</Label>
              <Input type="number" min={1} value={capacity} onChange={(e) => setCapacity(Number(e.target.value))} />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2">
                <Switch checked={active} onCheckedChange={setActive} />
                <span className="text-sm">Activos</span>
              </label>
            </div>
          </div>
          {preview && (
            <div className="rounded border bg-muted/30 p-3 text-sm">
              Se crearán <b>{preview.created}</b> horarios. Se omitirán <b>{preview.skipped}</b> duplicados.
            </div>
          )}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button variant="outline" onClick={doPreview}>Previsualizar</Button>
          <Button onClick={submit} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Generar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------- block / unblock day ----------
function BlockDayDialog({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
}) {
  const [date, setDate] = useState(todayISO());
  const [action, setAction] = useState<"block" | "unblock">("block");
  const [saving, setSaving] = useState(false);

  const dayInfo = useQuery({
    queryKey: ["block_day_info", date],
    enabled: open && !!date,
    queryFn: async () => {
      const [{ data: slots }, { data: bks }] = await Promise.all([
        supabase.from("availability_slots").select("id, active").eq("date", date),
        supabase
          .from("bookings")
          .select("id")
          .eq("scheduled_date", date)
          .neq("booking_status", "cancelled"),
      ]);
      return {
        slots: slots ?? [],
        bookings: (bks ?? []).length,
      };
    },
  });

  const submit = async () => {
    setSaving(true);
    try {
      const slots = dayInfo.data?.slots ?? [];
      if (!slots.length) {
        toast.info("No hay horarios creados para este día.");
        onOpenChange(false);
        return;
      }
      if (action === "block" && (dayInfo.data?.bookings ?? 0) > 0) {
        const ok = window.confirm(
          `Este día tiene ${dayInfo.data?.bookings} reserva(s). Bloquear el día no cancela las reservas existentes. ¿Continuar?`,
        );
        if (!ok) return;
      }
      const { error } = await supabase
        .from("availability_slots")
        .update({ active: action === "unblock" })
        .eq("date", date);
      if (error) throw error;
      toast.success(action === "block" ? "Día bloqueado" : "Día desbloqueado");
      onSaved();
      onOpenChange(false);
    } catch (e: any) {
      toast.error("Error", { description: e.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Bloquear / desbloquear día</DialogTitle>
          <DialogDescription>
            Activá o desactivá todos los horarios de un día específico.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div>
            <Label>Fecha</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <Label>Acción</Label>
            <Select value={action} onValueChange={(v) => setAction(v as any)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="block">Bloquear</SelectItem>
                <SelectItem value="unblock">Desbloquear</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {dayInfo.data && (
            <div className="rounded border bg-muted/30 p-3 text-xs">
              {dayInfo.data.slots.length === 0 ? (
                <>No hay horarios creados para este día.</>
              ) : (
                <>
                  {dayInfo.data.slots.length} horario(s) en este día.{" "}
                  {dayInfo.data.bookings > 0 && (
                    <span className="text-amber-700">
                      Hay {dayInfo.data.bookings} reserva(s); no se cancelarán.
                    </span>
                  )}
                </>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={submit} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Confirmar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
