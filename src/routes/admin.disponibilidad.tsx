import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
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
  Lock,
  RefreshCw,
  Pencil,
  Trash2,
  AlertTriangle,
  Loader2,
  Power,
  PowerOff,
  Save,
  Sparkles,
  Unlock,
} from "lucide-react";

export const Route = createFileRoute("/admin/disponibilidad")({
  component: DisponibilidadPage,
});

// ---------- types ----------
type Slot = {
  id: string;
  date: string;
  start_time: string;
  end_time: string;
  capacity: number;
  active: boolean;
  created_at: string;
  updated_at: string;
};

type WeeklyRule = {
  id: string;
  day_of_week: number;
  day_name: string;
  is_open: boolean;
  start_time: string;
  end_time: string;
  slot_duration_minutes: number;
  interval_minutes: number;
  capacity: number;
  allow_overlaps: boolean;
};

type Exception = {
  id: string;
  date: string;
  is_closed: boolean;
  note: string | null;
  created_at: string;
};

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
  const [tab, setTab] = useState("horarios");

  const refreshAll = () => {
    qc.invalidateQueries({ queryKey: ["availability_slots"] });
    qc.invalidateQueries({ queryKey: ["availability_bookings"] });
    qc.invalidateQueries({ queryKey: ["availability_exceptions"] });
    qc.invalidateQueries({ queryKey: ["weekly_rules"] });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Disponibilidad</h1>
          <p className="text-sm text-muted-foreground">
            Gestioná horarios, reglas semanales y bloqueos de fechas.
          </p>
        </div>
        <Button variant="outline" onClick={refreshAll}>
          <RefreshCw className="mr-2 h-4 w-4" /> Actualizar
        </Button>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
        <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 p-1">
          <TabsTrigger value="horarios">Horarios</TabsTrigger>
          <TabsTrigger value="generador">Generador</TabsTrigger>
          <TabsTrigger value="reglas">Reglas semanales</TabsTrigger>
          <TabsTrigger value="bloqueos">Bloqueos</TabsTrigger>
          <TabsTrigger value="diagnostico">Diagnóstico</TabsTrigger>
        </TabsList>

        <TabsContent value="horarios">
          <SlotsTab onChanged={refreshAll} />
        </TabsContent>
        <TabsContent value="generador">
          <GeneradorTab onSaved={refreshAll} />
        </TabsContent>
        <TabsContent value="reglas">
          <WeeklyRulesTab onSaved={refreshAll} />
        </TabsContent>
        <TabsContent value="bloqueos">
          <BlocksTab onSaved={refreshAll} />
        </TabsContent>
        <TabsContent value="diagnostico">
          <DiagnosticoTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ============================================================
// TAB 1 — HORARIOS
// ============================================================

type RangePreset = "today" | "7" | "14" | "month" | "custom";
type StatusFilter = "all" | "active" | "inactive";
type CapFilter = "all" | "available" | "full";

function SlotsTab({ onChanged }: { onChanged: () => void }) {
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

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkConfirm, setBulkConfirm] = useState<null | "activate" | "deactivate" | "delete" | "capacity">(null);
  const [forceDelete, setForceDelete] = useState(false);
  const [newCap, setNewCap] = useState(1);

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
        .select("scheduled_date, scheduled_time, duration_minutes, booking_status")
        .gte("scheduled_date", from)
        .lte("scheduled_date", to)
        .neq("booking_status", "cancelled");
      if (error) throw error;
      return (data ?? []) as {
        scheduled_date: string;
        scheduled_time: string;
        duration_minutes: number;
        booking_status: string;
      }[];
    },
  });

  const toMin = (t: string) => {
    const [h, m] = String(t).slice(0, 5).split(":").map(Number);
    return h * 60 + m;
  };

  // overlap-aware bookings count per slot
  const overlapCountForSlot = (s: Slot) => {
    const list = (bookingsQuery.data ?? []).filter((b) => b.scheduled_date === s.date);
    const sStart = toMin(s.start_time);
    const sEnd = toMin(s.end_time);
    let n = 0;
    for (const b of list) {
      const bs = toMin(b.scheduled_time);
      const be = bs + (b.duration_minutes ?? 0);
      if (bs < sEnd && be > sStart) n++;
    }
    return n;
  };

  const bookingsForDate = (date: string) => {
    return (bookingsQuery.data ?? []).filter((b) => b.scheduled_date === date).length;
  };

  const filtered = useMemo(() => {
    return (slotsQuery.data ?? []).filter((s) => {
      if (status === "active" && !s.active) return false;
      if (status === "inactive" && s.active) return false;
      const used = overlapCountForSlot(s);
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
  }, [slotsQuery.data, bookingsQuery.data, status, cap, search]);

  const grouped = useMemo(() => {
    const map = new Map<string, Slot[]>();
    for (const s of filtered) {
      const arr = map.get(s.date) ?? [];
      arr.push(s);
      map.set(s.date, arr);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["availability_slots"] });
    qc.invalidateQueries({ queryKey: ["availability_bookings"] });
    onChanged();
  };

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const selectAllVisible = () => setSelected(new Set(filtered.map((s) => s.id)));
  const clearSelection = () => setSelected(new Set());
  const selectDate = (date: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const s of filtered.filter((x) => x.date === date)) next.add(s.id);
      return next;
    });
  };

  const selectedSlots = useMemo(
    () => (slotsQuery.data ?? []).filter((s) => selected.has(s.id)),
    [slotsQuery.data, selected],
  );
  const selectedWithBookings = useMemo(
    () => selectedSlots.filter((s) => overlapCountForSlot(s) > 0),
    [selectedSlots, bookingsQuery.data],
  );

  const toggleActive = async (s: Slot) => {
    const used = overlapCountForSlot(s);
    if (s.active && used > 0) {
      const ok = window.confirm(
        `Este horario tiene ${used} reserva(s). Desactivarlo no cancela las reservas existentes. ¿Continuar?`,
      );
      if (!ok) return;
    }
    const { error } = await supabase
      .from("availability_slots")
      .update({ active: !s.active })
      .eq("id", s.id);
    if (error) return toast.error("No se pudo actualizar", { description: error.message });
    toast.success(s.active ? "Horario desactivado" : "Horario activado");
    refresh();
  };

  const dayActivate = async (date: string, active: boolean) => {
    const ids = (slotsQuery.data ?? []).filter((s) => s.date === date).map((s) => s.id);
    if (!ids.length) return;
    const { error } = await supabase
      .from("availability_slots")
      .update({ active })
      .in("id", ids);
    if (error) return toast.error("Error", { description: error.message });
    toast.success(active ? "Día activado" : "Día desactivado");
    refresh();
  };

  const dayDeleteEmpty = async (date: string) => {
    const slots = (slotsQuery.data ?? []).filter((s) => s.date === date);
    const empty = slots.filter((s) => overlapCountForSlot(s) === 0);
    if (!empty.length) return toast.info("No hay horarios sin reservas en este día.");
    const { error } = await supabase
      .from("availability_slots")
      .delete()
      .in("id", empty.map((s) => s.id));
    if (error) return toast.error("Error", { description: error.message });
    toast.success(`Eliminados ${empty.length} horarios sin reservas`);
    refresh();
  };

  const runBulk = async () => {
    if (!bulkConfirm) return;
    const ids = selectedSlots.map((s) => s.id);
    if (!ids.length) return;

    if (bulkConfirm === "activate") {
      const { error } = await supabase
        .from("availability_slots")
        .update({ active: true })
        .in("id", ids);
      if (error) return toast.error("Error", { description: error.message });
      toast.success(`${ids.length} horarios activados`);
    } else if (bulkConfirm === "deactivate") {
      const { error } = await supabase
        .from("availability_slots")
        .update({ active: false })
        .in("id", ids);
      if (error) return toast.error("Error", { description: error.message });
      toast.success(`${ids.length} horarios desactivados`);
    } else if (bulkConfirm === "delete") {
      const targets = forceDelete
        ? selectedSlots
        : selectedSlots.filter((s) => overlapCountForSlot(s) === 0);
      if (!targets.length) return toast.info("No hay horarios para eliminar.");
      const { error } = await supabase
        .from("availability_slots")
        .delete()
        .in("id", targets.map((s) => s.id));
      if (error) return toast.error("Error", { description: error.message });
      toast.success(`${targets.length} horarios eliminados`, {
        description: forceDelete
          ? undefined
          : `${selectedSlots.length - targets.length} omitidos por tener reservas`,
      });
    } else if (bulkConfirm === "capacity") {
      if (newCap < 1) return toast.error("Capacidad inválida");
      const conflicts = selectedSlots.filter((s) => overlapCountForSlot(s) > newCap);
      if (conflicts.length) {
        const ok = window.confirm(
          `${conflicts.length} horarios tienen más reservas que la nueva capacidad. ¿Continuar igual?`,
        );
        if (!ok) return;
      }
      const { error } = await supabase
        .from("availability_slots")
        .update({ capacity: newCap })
        .in("id", ids);
      if (error) return toast.error("Error", { description: error.message });
      toast.success(`Capacidad actualizada en ${ids.length} horarios`);
    }
    setBulkConfirm(null);
    setForceDelete(false);
    clearSelection();
    refresh();
  };

  const loading = slotsQuery.isLoading || bookingsQuery.isLoading;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setCreating(true)}>
          <CalendarPlus className="mr-2 h-4 w-4" /> Crear horario
        </Button>
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
          <div className="flex flex-wrap gap-2 text-xs">
            <Button size="sm" variant="outline" onClick={selectAllVisible}>
              Seleccionar todos los visibles
            </Button>
            {selected.size > 0 && (
              <Button size="sm" variant="ghost" onClick={clearSelection}>
                Limpiar selección
              </Button>
            )}
          </div>
          {grouped.map(([date, slots]) => {
            const activeCount = slots.filter((s) => s.active).length;
            const inactiveCount = slots.length - activeCount;
            const bookings = bookingsForDate(date);
            const fullCount = slots.filter((s) => s.capacity - overlapCountForSlot(s) <= 0).length;
            return (
              <Card key={date}>
                <CardHeader className="flex flex-col gap-2 pb-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <CardTitle className="text-base">
                      {dayName(date)} — {fmtDate(date)}
                    </CardTitle>
                    <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                      <Badge variant="secondary">{activeCount} activos</Badge>
                      {inactiveCount > 0 && <Badge variant="outline">{inactiveCount} inactivos</Badge>}
                      <Badge variant="outline">{bookings} reservas</Badge>
                      {fullCount > 0 && <Badge variant="destructive">{fullCount} llenos</Badge>}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <Button size="sm" variant="outline" onClick={() => selectDate(date)}>
                      Seleccionar día
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => dayActivate(date, true)}>
                      <Power className="mr-1 h-3 w-3" /> Activar
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => dayActivate(date, false)}>
                      <PowerOff className="mr-1 h-3 w-3" /> Desactivar
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => dayDeleteEmpty(date)}>
                      <Trash2 className="mr-1 h-3 w-3" /> Sin reservas
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  {/* Desktop */}
                  <div className="hidden md:block">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-10"></TableHead>
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
                          const used = overlapCountForSlot(s);
                          const remaining = s.capacity - used;
                          return (
                            <TableRow key={s.id} data-state={selected.has(s.id) ? "selected" : undefined}>
                              <TableCell>
                                <Checkbox
                                  checked={selected.has(s.id)}
                                  onCheckedChange={() => toggleOne(s.id)}
                                />
                              </TableCell>
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
                                ) : used > 0 ? (
                                  remaining <= 0 ? (
                                    <Badge variant="destructive">Lleno</Badge>
                                  ) : (
                                    <Badge variant="secondary">Tiene reservas</Badge>
                                  )
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
                      const used = overlapCountForSlot(s);
                      const remaining = s.capacity - used;
                      return (
                        <div
                          key={s.id}
                          className={`rounded-lg border p-3 ${selected.has(s.id) ? "border-primary bg-primary/5" : ""}`}
                        >
                          <div className="flex items-center justify-between">
                            <label className="flex items-center gap-2 font-medium">
                              <Checkbox
                                checked={selected.has(s.id)}
                                onCheckedChange={() => toggleOne(s.id)}
                              />
                              {hhmm(s.start_time)} – {hhmm(s.end_time)}
                            </label>
                            {!s.active ? (
                              <Badge variant="outline">Inactivo</Badge>
                            ) : remaining <= 0 ? (
                              <Badge variant="destructive">Lleno</Badge>
                            ) : used > 0 ? (
                              <Badge variant="secondary">Reservas</Badge>
                            ) : (
                              <Badge>Disponible</Badge>
                            )}
                          </div>
                          <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                            <div>Cap: {s.capacity}</div>
                            <div>Reservas: {used}</div>
                            <div>Restante: {Math.max(remaining, 0)}</div>
                          </div>
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

      {/* Sticky bulk action bar */}
      {selected.size > 0 && (
        <div className="sticky bottom-2 z-30 mx-auto flex w-full max-w-3xl flex-wrap items-center justify-between gap-3 rounded-lg border bg-background p-3 shadow-lg">
          <div className="text-sm">
            <b>{selected.size}</b> horarios seleccionados ·{" "}
            <span className="text-amber-700">{selectedWithBookings.length}</span> con reservas ·{" "}
            <span className="text-muted-foreground">
              {selected.size - selectedWithBookings.length} sin reservas
            </span>
          </div>
          <div className="flex flex-wrap gap-1">
            <Button size="sm" variant="outline" onClick={() => setBulkConfirm("activate")}>
              <Power className="mr-1 h-3 w-3" /> Activar
            </Button>
            <Button size="sm" variant="outline" onClick={() => setBulkConfirm("deactivate")}>
              <PowerOff className="mr-1 h-3 w-3" /> Desactivar
            </Button>
            <Button size="sm" variant="outline" onClick={() => setBulkConfirm("capacity")}>
              Capacidad
            </Button>
            <Button size="sm" variant="destructive" onClick={() => setBulkConfirm("delete")}>
              <Trash2 className="mr-1 h-3 w-3" /> Eliminar
            </Button>
            <Button size="sm" variant="ghost" onClick={clearSelection}>
              Cancelar
            </Button>
          </div>
        </div>
      )}

      {/* Bulk confirm dialog */}
      <AlertDialog open={!!bulkConfirm} onOpenChange={(o) => !o && (setBulkConfirm(null), setForceDelete(false))}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {bulkConfirm === "activate" && "Activar horarios"}
              {bulkConfirm === "deactivate" && "Desactivar horarios"}
              {bulkConfirm === "delete" && "Eliminar horarios"}
              {bulkConfirm === "capacity" && "Cambiar capacidad"}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <div>
                  Horarios seleccionados: <b>{selectedSlots.length}</b>. Con reservas:{" "}
                  <b>{selectedWithBookings.length}</b>.
                </div>
                {bulkConfirm === "deactivate" && selectedWithBookings.length > 0 && (
                  <div className="text-amber-700">
                    Algunos horarios tienen reservas. Desactivarlos no cancela las reservas existentes.
                  </div>
                )}
                {bulkConfirm === "delete" && (
                  <>
                    <div>
                      Por defecto se eliminarán <b>{selectedSlots.length - selectedWithBookings.length}</b>{" "}
                      horarios sin reservas. Los <b>{selectedWithBookings.length}</b> con reservas serán omitidos.
                    </div>
                    {selectedWithBookings.length > 0 && (
                      <label className="flex items-center gap-2 rounded border border-destructive/40 bg-destructive/5 p-2 text-destructive">
                        <Checkbox
                          checked={forceDelete}
                          onCheckedChange={(v) => setForceDelete(!!v)}
                        />
                        <span className="text-xs">
                          Entiendo el riesgo y quiero eliminar también horarios con reservas
                        </span>
                      </label>
                    )}
                  </>
                )}
                {bulkConfirm === "capacity" && (
                  <div>
                    <Label>Nueva capacidad</Label>
                    <Input
                      type="number"
                      min={1}
                      value={newCap}
                      onChange={(e) => setNewCap(Number(e.target.value))}
                    />
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={runBulk}>Confirmar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Dialogs */}
      <SlotFormDialog open={creating} onOpenChange={setCreating} onSaved={refresh} />
      <SlotFormDialog
        open={!!editing}
        slot={editing}
        existingBookings={editing ? overlapCountForSlot(editing) : 0}
        onOpenChange={(o) => !o && setEditing(null)}
        onSaved={refresh}
      />
      <DeleteSlotDialog
        slot={deleting}
        bookings={deleting ? overlapCountForSlot(deleting) : 0}
        onOpenChange={(o) => !o && setDeleting(null)}
        onDeleted={refresh}
      />
    </div>
  );
}

// ============================================================
// SlotFormDialog & DeleteSlotDialog (kept from previous version)
// ============================================================

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

  useEffect(() => {
    if (open) {
      setDate(slot?.date ?? todayISO());
      setStartTime(hhmm(slot?.start_time ?? "09:00"));
      setEndTime(hhmm(slot?.end_time ?? "10:30"));
      setCapacity(slot?.capacity ?? 1);
      setActive(slot?.active ?? true);
    }
  }, [open, slot]);

  const submit = async () => {
    if (!date || !startTime || !endTime) return toast.error("Completá todos los campos");
    if (endTime <= startTime) return toast.error("La hora de fin debe ser mayor a la de inicio");
    if (capacity < 1) return toast.error("La capacidad debe ser al menos 1");
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
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar horario" : "Crear horario"}</DialogTitle>
          <DialogDescription>
            {isEdit ? "Modificá los datos del horario." : "Definí fecha, horario y capacidad."}
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
            <Input type="number" min={1} value={capacity} onChange={(e) => setCapacity(Number(e.target.value))} />
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
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={submit} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

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
      return toast.error("Escribí 'eliminar' para confirmar");
    }
    const { error } = await supabase.from("availability_slots").delete().eq("id", slot.id);
    if (error) return toast.error("No se pudo eliminar", { description: error.message });
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
          <AlertDialogDescription asChild>
            <div>
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
            </div>
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

// ============================================================
// TAB 2 — GENERADOR
// ============================================================

const WEEKDAYS = [
  { v: 1, l: "Lun" },
  { v: 2, l: "Mar" },
  { v: 3, l: "Mié" },
  { v: 4, l: "Jue" },
  { v: 5, l: "Vie" },
  { v: 6, l: "Sáb" },
  { v: 0, l: "Dom" },
];

function GeneradorTab({ onSaved }: { onSaved: () => void }) {
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
    if (!cand.length) return setPreview({ created: 0, skipped: 0 });
    const { data: existing } = await supabase
      .from("availability_slots")
      .select("date, start_time")
      .gte("date", startDate)
      .lte("date", endDate);
    const existSet = new Set((existing ?? []).map((e: any) => `${e.date}|${e.start_time}`));
    let skipped = 0;
    for (const c of cand) if (existSet.has(`${c.date}|${c.start_time}`)) skipped++;
    setPreview({ created: cand.length - skipped, skipped });
  };

  const submit = async () => {
    setSaving(true);
    try {
      const cand = generateCandidates();
      if (!cand.length) return toast.error("No hay horarios para generar");
      const { data: existing } = await supabase
        .from("availability_slots")
        .select("date, start_time")
        .gte("date", startDate)
        .lte("date", endDate);
      const existSet = new Set((existing ?? []).map((e: any) => `${e.date}|${e.start_time}`));
      const rows = cand
        .filter((c) => !existSet.has(`${c.date}|${c.start_time}`))
        .map((c) => ({ ...c, capacity, active }));
      if (!rows.length) {
        toast.info("Todos los horarios ya existían");
        return;
      }
      const { error } = await supabase.from("availability_slots").insert(rows);
      if (error) throw error;
      toast.success(`Se crearon ${rows.length} horarios`, {
        description: `Omitidos: ${cand.length - rows.length}`,
      });
      setPreview(null);
      onSaved();
    } catch (e: any) {
      toast.error("Error al generar", { description: e.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Generador de horarios</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
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
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label>Apertura</Label>
            <Input type="time" value={dayStart} onChange={(e) => setDayStart(e.target.value)} />
          </div>
          <div>
            <Label>Cierre</Label>
            <Input type="time" value={dayEnd} onChange={(e) => setDayEnd(e.target.value)} />
          </div>
        </div>
        <div>
          <Label>Duración del turno (min)</Label>
          <Select value={String(duration)} onValueChange={(v) => setDuration(Number(v))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="60">60</SelectItem>
              <SelectItem value="90">90</SelectItem>
              <SelectItem value="120">120</SelectItem>
            </SelectContent>
          </Select>
          <p className="mt-1 text-xs text-muted-foreground">
            Por defecto los inicios se separan por la misma duración (sin solapamientos).
          </p>
        </div>
        <div className="flex items-center justify-between rounded border p-3">
          <div>
            <div className="text-sm font-medium">Permitir horarios solapados</div>
            <div className="text-xs text-muted-foreground">
              Inicios cada X minutos menores a la duración. Avanzado.
            </div>
          </div>
          <Switch checked={allowOverlap} onCheckedChange={setAllowOverlap} />
        </div>
        {allowOverlap && (
          <>
            <div>
              <Label>Intervalo entre inicios (min)</Label>
              <Select value={String(interval)} onValueChange={(v) => setInterval(Number(v))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="30">30</SelectItem>
                  <SelectItem value="60">60</SelectItem>
                  <SelectItem value="90">90</SelectItem>
                  <SelectItem value="120">120</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-start gap-2 rounded border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800">
              <AlertTriangle className="mt-0.5 h-4 w-4" />
              <div>
                Esto puede generar horarios solapados. El backend evita sobreventa según capacidad y duración del servicio, pero la operación puede ser más difícil de manejar.
              </div>
            </div>
          </>
        )}
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
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={doPreview}>Previsualizar</Button>
          <Button onClick={submit} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Generar
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================
// TAB 3 — REGLAS SEMANALES
// ============================================================

function WeeklyRulesTab({ onSaved }: { onSaved: () => void }) {
  const qc = useQueryClient();
  const [generating, setGenerating] = useState<null | 14 | 30>(null);

  const rulesQuery = useQuery({
    queryKey: ["weekly_rules"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("weekly_availability_rules")
        .select("*")
        .order("day_of_week", { ascending: true });
      if (error) throw error;
      return (data ?? []) as WeeklyRule[];
    },
  });

  const [draft, setDraft] = useState<Record<string, WeeklyRule>>({});

  useEffect(() => {
    if (rulesQuery.data) {
      const map: Record<string, WeeklyRule> = {};
      for (const r of rulesQuery.data) map[r.id] = { ...r };
      setDraft(map);
    }
  }, [rulesQuery.data]);

  const update = (id: string, patch: Partial<WeeklyRule>) =>
    setDraft((s) => ({ ...s, [id]: { ...s[id], ...patch } }));

  const saveOne = async (r: WeeklyRule) => {
    const { error } = await supabase
      .from("weekly_availability_rules")
      .update({
        is_open: r.is_open,
        start_time: toTimeStr(hhmm(r.start_time)),
        end_time: toTimeStr(hhmm(r.end_time)),
        slot_duration_minutes: r.slot_duration_minutes,
        interval_minutes: r.allow_overlaps ? r.interval_minutes : r.slot_duration_minutes,
        capacity: r.capacity,
        allow_overlaps: r.allow_overlaps,
      })
      .eq("id", r.id);
    if (error) return toast.error("Error", { description: error.message });
    toast.success(`Regla ${r.day_name} guardada`);
    qc.invalidateQueries({ queryKey: ["weekly_rules"] });
  };

  const saveAll = async () => {
    for (const r of Object.values(draft)) await saveOne(r);
  };

  const generateFromRules = async (days: 14 | 30) => {
    setGenerating(days);
    try {
      const rules = Object.values(draft).filter((r) => r.is_open);
      const start = todayISO();
      const end = addDays(start, days);
      const cand: { date: string; start_time: string; end_time: string; capacity: number; active: boolean }[] = [];

      // exceptions to skip
      const { data: excs } = await supabase
        .from("availability_exceptions")
        .select("date,is_closed")
        .gte("date", start)
        .lte("date", end);
      const closedDates = new Set((excs ?? []).filter((e: any) => e.is_closed).map((e: any) => e.date));

      let cur = start;
      while (cur <= end) {
        if (!closedDates.has(cur)) {
          const dow = new Date(cur + "T00:00:00").getDay();
          const r = rules.find((x) => x.day_of_week === dow);
          if (r) {
            const dur = r.slot_duration_minutes;
            const step = r.allow_overlaps ? r.interval_minutes : dur;
            let t = hhmm(r.start_time);
            const dayEnd = hhmm(r.end_time);
            while (true) {
              const end_t = addMinutesToTime(t, dur);
              if (end_t > dayEnd) break;
              cand.push({
                date: cur,
                start_time: toTimeStr(t),
                end_time: toTimeStr(end_t),
                capacity: r.capacity,
                active: true,
              });
              const next = addMinutesToTime(t, step);
              if (next <= t) break;
              t = next;
              if (t >= dayEnd) break;
            }
          }
        }
        cur = addDays(cur, 1);
      }

      const { data: existing } = await supabase
        .from("availability_slots")
        .select("date,start_time")
        .gte("date", start)
        .lte("date", end);
      const existSet = new Set((existing ?? []).map((e: any) => `${e.date}|${e.start_time}`));
      const rows = cand.filter((c) => !existSet.has(`${c.date}|${c.start_time}`));
      if (!rows.length) {
        toast.info("Todos los horarios ya existían");
        return;
      }
      const { error } = await supabase.from("availability_slots").insert(rows);
      if (error) throw error;
      toast.success(`Generados ${rows.length} horarios`, {
        description: `Duplicados omitidos: ${cand.length - rows.length}`,
      });
      onSaved();
    } catch (e: any) {
      toast.error("Error", { description: e.message });
    } finally {
      setGenerating(null);
    }
  };

  if (rulesQuery.isLoading) {
    return (
      <div className="flex items-center justify-center p-10 text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Cargando...
      </div>
    );
  }

  const ordered = [1, 2, 3, 4, 5, 6, 0]
    .map((dow) => Object.values(draft).find((r) => r.day_of_week === dow))
    .filter(Boolean) as WeeklyRule[];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Reglas semanales</CardTitle>
          <p className="text-sm text-muted-foreground">
            Definí horarios por día de la semana. Sirven para generar disponibilidad rápidamente.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {ordered.map((r) => (
            <div key={r.id} className="rounded-lg border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-3">
                  <Switch
                    checked={r.is_open}
                    onCheckedChange={(v) => update(r.id, { is_open: v })}
                  />
                  <div className="font-medium">{r.day_name}</div>
                  <Badge variant={r.is_open ? "default" : "outline"}>
                    {r.is_open ? "Abierto" : "Cerrado"}
                  </Badge>
                </div>
                <Button size="sm" variant="outline" onClick={() => saveOne(r)}>
                  <Save className="mr-1 h-3 w-3" /> Guardar
                </Button>
              </div>
              {r.is_open && (
                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-6">
                  <div>
                    <Label className="text-xs">Apertura</Label>
                    <Input
                      type="time"
                      value={hhmm(r.start_time)}
                      onChange={(e) => update(r.id, { start_time: toTimeStr(e.target.value) })}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Cierre</Label>
                    <Input
                      type="time"
                      value={hhmm(r.end_time)}
                      onChange={(e) => update(r.id, { end_time: toTimeStr(e.target.value) })}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Duración (min)</Label>
                    <Input
                      type="number"
                      min={15}
                      value={r.slot_duration_minutes}
                      onChange={(e) => update(r.id, { slot_duration_minutes: Number(e.target.value) })}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Intervalo (min)</Label>
                    <Input
                      type="number"
                      min={15}
                      value={r.allow_overlaps ? r.interval_minutes : r.slot_duration_minutes}
                      disabled={!r.allow_overlaps}
                      onChange={(e) => update(r.id, { interval_minutes: Number(e.target.value) })}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Capacidad</Label>
                    <Input
                      type="number"
                      min={1}
                      value={r.capacity}
                      onChange={(e) => update(r.id, { capacity: Number(e.target.value) })}
                    />
                  </div>
                  <div className="flex items-end">
                    <label className="flex items-center gap-2 text-xs">
                      <Switch
                        checked={r.allow_overlaps}
                        onCheckedChange={(v) => update(r.id, { allow_overlaps: v })}
                      />
                      Solapar
                    </label>
                  </div>
                </div>
              )}
            </div>
          ))}
          <div className="flex flex-wrap gap-2 pt-2">
            <Button variant="outline" onClick={saveAll}>
              <Save className="mr-2 h-4 w-4" /> Guardar todos
            </Button>
            <Button onClick={() => generateFromRules(14)} disabled={!!generating}>
              {generating === 14 && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              <Sparkles className="mr-2 h-4 w-4" /> Generar próximos 14 días
            </Button>
            <Button variant="secondary" onClick={() => generateFromRules(30)} disabled={!!generating}>
              {generating === 30 && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Generar próximos 30 días
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================
// TAB 4 — BLOQUEOS / EXCEPCIONES
// ============================================================

function BlocksTab({ onSaved }: { onSaved: () => void }) {
  const qc = useQueryClient();
  const [singleDate, setSingleDate] = useState(todayISO());
  const [singleNote, setSingleNote] = useState("");
  const [rangeFrom, setRangeFrom] = useState(todayISO());
  const [rangeTo, setRangeTo] = useState(addDays(todayISO(), 7));
  const [rangeNote, setRangeNote] = useState("");
  const [busy, setBusy] = useState(false);

  const exceptionsQuery = useQuery({
    queryKey: ["availability_exceptions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("availability_exceptions")
        .select("*")
        .order("date", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Exception[];
    },
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["availability_exceptions"] });
    onSaved();
  };

  const blockOne = async () => {
    setBusy(true);
    try {
      const { count } = await supabase
        .from("bookings")
        .select("id", { head: true, count: "exact" })
        .eq("scheduled_date", singleDate)
        .neq("booking_status", "cancelled");
      if ((count ?? 0) > 0) {
        const ok = window.confirm(
          `Hay ${count} reserva(s) ese día. Bloquearlo no las cancela. ¿Continuar?`,
        );
        if (!ok) return;
      }
      const { data: existing } = await supabase
        .from("availability_exceptions")
        .select("id")
        .eq("date", singleDate)
        .maybeSingle();
      if (existing) {
        await supabase.from("availability_exceptions").update({
          is_closed: true,
          note: singleNote || null,
        }).eq("id", existing.id);
      } else {
        await supabase.from("availability_exceptions").insert({
          date: singleDate,
          is_closed: true,
          note: singleNote || null,
        });
      }
      await supabase.from("availability_slots").update({ active: false }).eq("date", singleDate);
      toast.success("Fecha bloqueada");
      setSingleNote("");
      refresh();
    } catch (e: any) {
      toast.error("Error", { description: e.message });
    } finally {
      setBusy(false);
    }
  };

  const blockRange = async () => {
    if (rangeTo < rangeFrom) return toast.error("Rango inválido");
    setBusy(true);
    try {
      const { count } = await supabase
        .from("bookings")
        .select("id", { head: true, count: "exact" })
        .gte("scheduled_date", rangeFrom)
        .lte("scheduled_date", rangeTo)
        .neq("booking_status", "cancelled");
      if ((count ?? 0) > 0) {
        const ok = window.confirm(
          `Hay ${count} reserva(s) en el rango. Bloquearlo no las cancela. ¿Continuar?`,
        );
        if (!ok) return;
      }
      const dates: string[] = [];
      let cur = rangeFrom;
      while (cur <= rangeTo) {
        dates.push(cur);
        cur = addDays(cur, 1);
      }
      const { data: existing } = await supabase
        .from("availability_exceptions")
        .select("id,date")
        .in("date", dates);
      const existMap = new Map((existing ?? []).map((e: any) => [e.date, e.id]));
      for (const d of dates) {
        if (existMap.has(d)) {
          await supabase
            .from("availability_exceptions")
            .update({ is_closed: true, note: rangeNote || null })
            .eq("id", existMap.get(d)!);
        } else {
          await supabase.from("availability_exceptions").insert({
            date: d,
            is_closed: true,
            note: rangeNote || null,
          });
        }
      }
      await supabase
        .from("availability_slots")
        .update({ active: false })
        .gte("date", rangeFrom)
        .lte("date", rangeTo);
      toast.success(`Rango bloqueado (${dates.length} días)`);
      setRangeNote("");
      refresh();
    } catch (e: any) {
      toast.error("Error", { description: e.message });
    } finally {
      setBusy(false);
    }
  };

  const unblock = async (e: Exception) => {
    const reactivate = window.confirm(
      `Desbloquear ${e.date}.\n¿Reactivar también los horarios existentes de ese día?`,
    );
    await supabase.from("availability_exceptions").delete().eq("id", e.id);
    if (reactivate) {
      await supabase.from("availability_slots").update({ active: true }).eq("date", e.date);
    }
    toast.success("Fecha desbloqueada");
    refresh();
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Bloquear una fecha</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label>Fecha</Label>
            <Input type="date" value={singleDate} onChange={(e) => setSingleDate(e.target.value)} />
          </div>
          <div>
            <Label>Nota (opcional)</Label>
            <Input value={singleNote} onChange={(e) => setSingleNote(e.target.value)} placeholder="Feriado, lluvia, etc." />
          </div>
          <Button onClick={blockOne} disabled={busy}>
            <Lock className="mr-2 h-4 w-4" /> Bloquear fecha
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Bloquear un rango</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Desde</Label>
              <Input type="date" value={rangeFrom} onChange={(e) => setRangeFrom(e.target.value)} />
            </div>
            <div>
              <Label>Hasta</Label>
              <Input type="date" value={rangeTo} onChange={(e) => setRangeTo(e.target.value)} />
            </div>
          </div>
          <div>
            <Label>Nota (opcional)</Label>
            <Input value={rangeNote} onChange={(e) => setRangeNote(e.target.value)} placeholder="Vacaciones, etc." />
          </div>
          <Button onClick={blockRange} disabled={busy}>
            <Lock className="mr-2 h-4 w-4" /> Bloquear rango
          </Button>
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Excepciones registradas</CardTitle>
        </CardHeader>
        <CardContent>
          {exceptionsQuery.isLoading ? (
            <div className="text-sm text-muted-foreground">Cargando...</div>
          ) : (exceptionsQuery.data ?? []).length === 0 ? (
            <div className="text-sm text-muted-foreground">Sin excepciones registradas.</div>
          ) : (
            <div className="space-y-2">
              {(exceptionsQuery.data ?? []).map((e) => (
                <div
                  key={e.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={e.is_closed ? "destructive" : "outline"}>
                      {e.is_closed ? "Cerrado" : "Abierto"}
                    </Badge>
                    <span className="font-medium">{fmtDate(e.date)}</span>
                    <span className="text-xs text-muted-foreground">{dayName(e.date)}</span>
                    {e.note && <span className="text-sm text-muted-foreground">— {e.note}</span>}
                  </div>
                  <Button size="sm" variant="outline" onClick={() => unblock(e)}>
                    <Unlock className="mr-1 h-3 w-3" /> Desbloquear
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================
// TAB 5 — DIAGNÓSTICO
// ============================================================

function DiagnosticoTab() {
  const qc = useQueryClient();
  const today = todayISO();
  const horizon = addDays(today, 60);

  const slotsQuery = useQuery({
    queryKey: ["availability_slots", today, horizon],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("availability_slots")
        .select("*")
        .gte("date", today)
        .lte("date", horizon)
        .order("date", { ascending: true })
        .order("start_time", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Slot[];
    },
  });

  const bookingsQuery = useQuery({
    queryKey: ["availability_bookings", today, horizon],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bookings")
        .select("scheduled_date,scheduled_time,duration_minutes,booking_status")
        .gte("scheduled_date", today)
        .lte("scheduled_date", horizon)
        .neq("booking_status", "cancelled");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const toMin = (t: string) => {
    const [h, m] = String(t).slice(0, 5).split(":").map(Number);
    return h * 60 + m;
  };

  const overlapsForSlot = (s: Slot) => {
    const list = (bookingsQuery.data ?? []).filter((b) => b.scheduled_date === s.date);
    const sStart = toMin(s.start_time);
    const sEnd = toMin(s.end_time);
    let n = 0;
    for (const b of list) {
      const bs = toMin(b.scheduled_time);
      const be = bs + (b.duration_minutes ?? 0);
      if (bs < sEnd && be > sStart) n++;
    }
    return n;
  };

  const overlaps = useMemo(() => {
    const slots = slotsQuery.data ?? [];
    const byDate = new Map<string, Slot[]>();
    for (const s of slots) {
      const arr = byDate.get(s.date) ?? [];
      arr.push(s);
      byDate.set(s.date, arr);
    }
    const out: { date: string; a: Slot; b: Slot; aBks: number; bBks: number }[] = [];
    for (const [date, list] of byDate) {
      const sorted = [...list].sort((x, y) => x.start_time.localeCompare(y.start_time));
      for (let i = 0; i < sorted.length; i++) {
        for (let j = i + 1; j < sorted.length; j++) {
          const a = sorted[i], b = sorted[j];
          const aS = toMin(a.start_time), aE = toMin(a.end_time);
          const bS = toMin(b.start_time), bE = toMin(b.end_time);
          if (aS < bE && aE > bS) {
            out.push({
              date,
              a,
              b,
              aBks: overlapsForSlot(a),
              bBks: overlapsForSlot(b),
            });
          }
        }
      }
    }
    return out;
  }, [slotsQuery.data, bookingsQuery.data]);

  const totalDates = new Set(overlaps.map((o) => o.date)).size;
  const withBookings = overlaps.filter((o) => o.aBks > 0 || o.bBks > 0).length;
  const withoutBookings = overlaps.length - withBookings;

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["availability_slots"] });
    qc.invalidateQueries({ queryKey: ["availability_bookings"] });
  };

  const deactivate = async (id: string) => {
    await supabase.from("availability_slots").update({ active: false }).eq("id", id);
    toast.success("Slot desactivado");
    refresh();
  };
  const remove = async (id: string) => {
    if (!window.confirm("¿Eliminar slot?")) return;
    await supabase.from("availability_slots").delete().eq("id", id);
    toast.success("Slot eliminado");
    refresh();
  };

  if (slotsQuery.isLoading) {
    return (
      <div className="flex items-center justify-center p-10 text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Cargando...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="grid grid-cols-2 gap-3 p-4 text-sm sm:grid-cols-4">
          <div>
            <div className="text-xs text-muted-foreground">Pares solapados</div>
            <div className="text-2xl font-semibold">{overlaps.length}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Días afectados</div>
            <div className="text-2xl font-semibold">{totalDates}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Con reservas</div>
            <div className="text-2xl font-semibold text-amber-600">{withBookings}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Sin reservas</div>
            <div className="text-2xl font-semibold text-emerald-600">{withoutBookings}</div>
          </div>
        </CardContent>
      </Card>

      {overlaps.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            Sin solapamientos detectados en los próximos 60 días.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4 text-amber-600" /> Detalle de solapamientos
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {overlaps.slice(0, 100).map((o, i) => {
              const safe = o.aBks === 0 || o.bBks === 0;
              const safeSlot = o.aBks === 0 ? o.a : o.bBks === 0 ? o.b : null;
              return (
                <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border p-3">
                  <Badge variant="outline">{o.date}</Badge>
                  <span className="font-mono text-sm">
                    {hhmm(o.a.start_time)}–{hhmm(o.a.end_time)}{" "}
                    <Badge variant="secondary" className="ml-1">{o.aBks} reservas</Badge>
                  </span>
                  <span className="text-muted-foreground">⇄</span>
                  <span className="font-mono text-sm">
                    {hhmm(o.b.start_time)}–{hhmm(o.b.end_time)}{" "}
                    <Badge variant="secondary" className="ml-1">{o.bBks} reservas</Badge>
                  </span>
                  {o.aBks + o.bBks === 0 ? (
                    <Badge variant="outline">Sin reservas</Badge>
                  ) : (
                    <Badge variant="destructive">Con reservas</Badge>
                  )}
                  {safe && safeSlot && (
                    <div className="ml-auto flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => deactivate(safeSlot.id)}>
                        Desactivar sin reservas
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => remove(safeSlot.id)}>
                        Eliminar sin reservas
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
            {overlaps.length > 100 && (
              <div className="text-xs text-muted-foreground">… y {overlaps.length - 100} más.</div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
