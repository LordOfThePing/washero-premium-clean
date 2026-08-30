import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Search,
  Calendar as CalIcon,
} from "lucide-react";

import { db } from "@/integrations/db/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
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
} from "@/lib/booking-badges";
import {
  type Booking,
  fmtTime,
  useLookups,
  BookingDialogs,
} from "@/components/admin/bookings";

export const Route = createFileRoute("/admin/calendario")({
  component: AdminCalendar,
});

type View = "day" | "week" | "month";

// ===========================================================================
// Date helpers (local time, week starts Monday)
// ===========================================================================

const isoOf = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};
const addDays = (d: Date, n: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};
const startOfWeek = (d: Date) => {
  const x = new Date(d);
  const dow = (x.getDay() + 6) % 7; // Mon=0..Sun=6
  x.setDate(x.getDate() - dow);
  x.setHours(0, 0, 0, 0);
  return x;
};
const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
const endOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0);
const isSameDay = (a: Date, b: Date) => isoOf(a) === isoOf(b);

const dayNamesShort = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const dayNamesLong = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
const monthNames = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

const formatLongDate = (d: Date) =>
  `${dayNamesLong[(d.getDay() + 6) % 7]} ${d.getDate()} de ${monthNames[d.getMonth()]}`;
const formatMonthYear = (d: Date) => `${monthNames[d.getMonth()]} ${d.getFullYear()}`;

// ===========================================================================
// Page
// ===========================================================================

function AdminCalendar() {
  const qc = useQueryClient();
  const { services } = useLookups();

  const [view, setView] = useState<View>(
    typeof window !== "undefined" && window.innerWidth < 768 ? "day" : "week",
  );
  const [cursor, setCursor] = useState<Date>(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [paymentFilter, setPaymentFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [serviceFilter, setServiceFilter] = useState<string>("all");
  const [neighborhoodFilter, setNeighborhoodFilter] = useState<string>("all");
  const [filtersOpen, setFiltersOpen] = useState(false);

  const [selected, setSelected] = useState<Booking | null>(null);
  const [editing, setEditing] = useState<Booking | null>(null);
  const [creating, setCreating] = useState(false);
  const [createDate, setCreateDate] = useState<string | undefined>(undefined);
  const [createTime, setCreateTime] = useState<string | undefined>(undefined);

  // Range for query
  const range = useMemo(() => {
    if (view === "day") return { start: isoOf(cursor), end: isoOf(cursor) };
    if (view === "week") {
      const s = startOfWeek(cursor);
      return { start: isoOf(s), end: isoOf(addDays(s, 6)) };
    }
    return { start: isoOf(startOfMonth(cursor)), end: isoOf(endOfMonth(cursor)) };
  }, [cursor, view]);

  const bookingsQuery = useQuery({
    queryKey: ["admin", "calendar", range],
    queryFn: async () => {
      const { data, error } = await db
        .from("bookings")
        .select("*")
        .gte("scheduled_date", range.start)
        .lte("scheduled_date", range.end)
        .order("scheduled_date", { ascending: true })
        .order("scheduled_time", { ascending: true })
        .limit(1000);
      if (error) throw error;
      return (data ?? []) as Booking[];
    },
  });

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (bookingsQuery.data ?? []).filter((b) => {
      if (statusFilter !== "all" && b.booking_status !== statusFilter) return false;
      if (paymentFilter !== "all" && b.payment_status !== paymentFilter) return false;
      if (sourceFilter !== "all" && b.booking_source !== sourceFilter) return false;
      if (serviceFilter !== "all" && b.service_id !== serviceFilter) return false;
      if (neighborhoodFilter !== "all" && b.neighborhood !== neighborhoodFilter) return false;
      if (
        term &&
        ![b.customer_name, b.customer_phone, b.address, b.neighborhood]
          .filter(Boolean)
          .some((v) => v.toLowerCase().includes(term))
      )
        return false;
      return true;
    });
  }, [bookingsQuery.data, search, statusFilter, paymentFilter, sourceFilter, serviceFilter, neighborhoodFilter]);

  const byDate = useMemo(() => {
    const map = new Map<string, Booking[]>();
    for (const b of filtered) {
      const arr = map.get(b.scheduled_date) ?? [];
      arr.push(b);
      map.set(b.scheduled_date, arr);
    }
    return map;
  }, [filtered]);

  const neighborhoods = useMemo(() => {
    const set = new Set<string>();
    (bookingsQuery.data ?? []).forEach((b) => b.neighborhood && set.add(b.neighborhood));
    return Array.from(set).sort();
  }, [bookingsQuery.data]);

  const onMutate = () => {
    qc.invalidateQueries({ queryKey: ["admin", "calendar"] });
    qc.invalidateQueries({ queryKey: ["admin", "bookings"] });
    qc.invalidateQueries({ queryKey: ["admin", "metrics"] });
  };

  const goPrev = () => {
    if (view === "day") setCursor(addDays(cursor, -1));
    else if (view === "week") setCursor(addDays(cursor, -7));
    else setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1));
  };
  const goNext = () => {
    if (view === "day") setCursor(addDays(cursor, 1));
    else if (view === "week") setCursor(addDays(cursor, 7));
    else setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1));
  };
  const goToday = () => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    setCursor(d);
  };

  const headerLabel = useMemo(() => {
    if (view === "day") return formatLongDate(cursor);
    if (view === "week") {
      const s = startOfWeek(cursor);
      const e = addDays(s, 6);
      return `${s.getDate()} ${monthNames[s.getMonth()]} – ${e.getDate()} ${monthNames[e.getMonth()]} ${e.getFullYear()}`;
    }
    return formatMonthYear(cursor);
  }, [view, cursor]);

  const openCreate = (date?: Date, time?: string) => {
    setCreateDate(date ? isoOf(date) : isoOf(cursor));
    setCreateTime(time);
    setCreating(true);
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Calendario</h1>
          <p className="text-sm text-muted-foreground">Vista de reservas por día, semana y mes.</p>
        </div>
        <Button onClick={() => openCreate(cursor)}>
          <Plus className="mr-1 h-4 w-4" /> Nueva reserva
        </Button>
      </div>

      {/* Toolbar */}
      <Card className="sticky top-0 z-10">
        <CardContent className="flex flex-wrap items-center gap-3 p-3">
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" onClick={goPrev} aria-label="Anterior">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={goToday}>Hoy</Button>
            <Button variant="outline" size="icon" onClick={goNext} aria-label="Siguiente">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex-1 text-sm font-medium capitalize">{headerLabel}</div>
          <Tabs value={view} onValueChange={(v) => setView(v as View)}>
            <TabsList>
              <TabsTrigger value="day">Día</TabsTrigger>
              <TabsTrigger value="week">Semana</TabsTrigger>
              <TabsTrigger value="month">Mes</TabsTrigger>
            </TabsList>
          </Tabs>
        </CardContent>
      </Card>

      {/* Filters */}
      <Card>
        <CardContent className="space-y-3 p-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por nombre, teléfono, dirección o barrio"
                className="pl-8"
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              className="md:hidden"
              onClick={() => setFiltersOpen((v) => !v)}
            >
              Filtros
            </Button>
          </div>
          <div className={cn("grid gap-2 md:grid-cols-5", !filtersOpen && "hidden md:grid")}>
            <FilterField label="Estado">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {BOOKING_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>{bookingStatusLabels[s]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterField>
            <FilterField label="Pago">
              <Select value={paymentFilter} onValueChange={setPaymentFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {PAYMENT_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>{paymentStatusLabels[s]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterField>
            <FilterField label="Origen">
              <Select value={sourceFilter} onValueChange={setSourceFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {BOOKING_SOURCES.map((s) => (
                    <SelectItem key={s} value={s}>{bookingSourceLabels[s]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterField>
            <FilterField label="Servicio">
              <Select value={serviceFilter} onValueChange={setServiceFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {(services.data ?? []).map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterField>
            <FilterField label="Barrio">
              <Select value={neighborhoodFilter} onValueChange={setNeighborhoodFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {neighborhoods.map((n) => (
                    <SelectItem key={n} value={n}>{n}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterField>
          </div>
        </CardContent>
      </Card>

      {/* Body */}
      {bookingsQuery.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : bookingsQuery.isError ? (
        <Card>
          <CardContent className="p-6 text-sm text-destructive">
            No pudimos cargar el calendario. Intentá nuevamente.
          </CardContent>
        </Card>
      ) : view === "day" ? (
        <DayView
          date={cursor}
          bookings={byDate.get(isoOf(cursor)) ?? []}
          onSelect={setSelected}
          onCreate={(time) => openCreate(cursor, time)}
        />
      ) : view === "week" ? (
        <WeekView
          start={startOfWeek(cursor)}
          byDate={byDate}
          onSelect={setSelected}
          onPickDay={(d) => {
            setCursor(d);
            setView("day");
          }}
        />
      ) : (
        <MonthView
          cursor={cursor}
          byDate={byDate}
          onPickDay={(d) => {
            setCursor(d);
            setView("day");
          }}
        />
      )}

      <BookingDialogs
        selected={selected}
        setSelected={setSelected}
        editing={editing}
        setEditing={setEditing}
        creating={creating}
        setCreating={(o) => {
          setCreating(o);
          if (!o) {
            setCreateDate(undefined);
            setCreateTime(undefined);
          }
        }}
        createDefaults={{ date: createDate, time: createTime }}
        onMutate={onMutate}
      />
    </div>
  );
}

// ===========================================================================
// Day view
// ===========================================================================

function DayView({
  date,
  bookings,
  onSelect,
  onCreate,
}: {
  date: Date;
  bookings: Booking[];
  onSelect: (b: Booking) => void;
  onCreate: (time?: string) => void;
}) {
  const groups = useMemo(() => {
    const m = new Map<string, Booking[]>();
    for (const b of bookings) {
      const t = fmtTime(b.scheduled_time);
      const arr = m.get(t) ?? [];
      arr.push(b);
      m.set(t, arr);
    }
    return Array.from(m.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [bookings]);

  const summary = useMemo(() => {
    const s = { total: bookings.length, confirmed: 0, pending: 0, completed: 0, cancelled: 0 };
    for (const b of bookings) {
      if (b.booking_status === "confirmed") s.confirmed++;
      else if (b.booking_status === "pending" || b.booking_status === "needs_review") s.pending++;
      else if (b.booking_status === "completed") s.completed++;
      else if (b.booking_status === "cancelled") s.cancelled++;
    }
    return s;
  }, [bookings]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-full bg-muted px-2 py-1 font-medium">Total: {summary.total}</span>
        <span className="rounded-full bg-blue-100 px-2 py-1 text-blue-900 dark:bg-blue-500/15 dark:text-blue-300">
          Confirmadas: {summary.confirmed}
        </span>
        <span className="rounded-full bg-amber-100 px-2 py-1 text-amber-900 dark:bg-amber-500/15 dark:text-amber-300">
          Pendientes: {summary.pending}
        </span>
        <span className="rounded-full bg-green-100 px-2 py-1 text-green-900 dark:bg-green-500/15 dark:text-green-300">
          Completadas: {summary.completed}
        </span>
        <span className="rounded-full bg-red-100 px-2 py-1 text-red-900 dark:bg-red-500/15 dark:text-red-300">
          Canceladas: {summary.cancelled}
        </span>
      </div>

      {groups.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center text-sm text-muted-foreground">
            <CalIcon className="h-6 w-6" />
            No hay reservas para este día.
            <Button size="sm" variant="outline" onClick={() => onCreate()}>
              <Plus className="mr-1 h-4 w-4" /> Crear reserva
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {groups.map(([time, items]) => (
            <div key={time}>
              <div className="mb-1.5 flex items-center justify-between">
                <h3 className="text-sm font-semibold">{time}</h3>
                <Button size="sm" variant="ghost" onClick={() => onCreate(`${time}:00`)}>
                  <Plus className="mr-1 h-3.5 w-3.5" /> En este horario
                </Button>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {items.map((b) => (
                  <BookingChip key={b.id} booking={b} onClick={() => onSelect(b)} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ===========================================================================
// Week view
// ===========================================================================

function WeekView({
  start,
  byDate,
  onSelect,
  onPickDay,
}: {
  start: Date;
  byDate: Map<string, Booking[]>;
  onSelect: (b: Booking) => void;
  onPickDay: (d: Date) => void;
}) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const today = isoOf(new Date());
  const total = days.reduce((s, d) => s + (byDate.get(isoOf(d))?.length ?? 0), 0);

  if (total === 0) {
    return (
      <Card>
        <CardContent className="p-10 text-center text-sm text-muted-foreground">
          No hay reservas esta semana.
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      {/* Mobile: vertical list */}
      <div className="space-y-3 lg:hidden">
        {days.map((d) => {
          const items = byDate.get(isoOf(d)) ?? [];
          if (items.length === 0) return null;
          return (
            <div key={isoOf(d)}>
              <button
                className="mb-1.5 text-sm font-semibold capitalize hover:underline"
                onClick={() => onPickDay(d)}
              >
                {dayNamesLong[(d.getDay() + 6) % 7]} {d.getDate()}
              </button>
              <div className="grid gap-2">
                {items.map((b) => (
                  <BookingChip key={b.id} booking={b} onClick={() => onSelect(b)} />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Desktop: 7 columns */}
      <div className="hidden grid-cols-7 gap-2 lg:grid">
        {days.map((d) => {
          const iso = isoOf(d);
          const items = byDate.get(iso) ?? [];
          const isToday = iso === today;
          return (
            <Card key={iso} className={cn("flex flex-col", isToday && "ring-2 ring-primary")}>
              <button
                onClick={() => onPickDay(d)}
                className="border-b p-2 text-left hover:bg-muted/50"
              >
                <div className="text-xs uppercase text-muted-foreground">
                  {dayNamesShort[(d.getDay() + 6) % 7]}
                </div>
                <div className="text-lg font-semibold">{d.getDate()}</div>
                <div className="text-[10px] text-muted-foreground">
                  {items.length} reserva{items.length === 1 ? "" : "s"}
                </div>
              </button>
              <div className="flex-1 space-y-1.5 p-2">
                {items.length === 0 ? (
                  <p className="py-4 text-center text-xs text-muted-foreground">—</p>
                ) : (
                  items.map((b) => (
                    <button
                      key={b.id}
                      onClick={() => onSelect(b)}
                      className={cn(
                        "block w-full rounded-md border bg-card p-1.5 text-left text-xs hover:bg-muted",
                        b.booking_status === "cancelled" && "opacity-50",
                      )}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="font-medium">{fmtTime(b.scheduled_time)}</span>
                        <span className={cn("h-2 w-2 rounded-full", statusDot(b.booking_status))} />
                      </div>
                      <div className="truncate">{b.customer_name}</div>
                      <div className="truncate text-muted-foreground">{b.service_name}</div>
                    </button>
                  ))
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </>
  );
}

// ===========================================================================
// Month view
// ===========================================================================

function MonthView({
  cursor,
  byDate,
  onPickDay,
}: {
  cursor: Date;
  byDate: Map<string, Booking[]>;
  onPickDay: (d: Date) => void;
}) {
  const monthStart = startOfMonth(cursor);
  const gridStart = startOfWeek(monthStart);
  const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const today = isoOf(new Date());
  const total = cells.reduce(
    (s, d) =>
      d.getMonth() === cursor.getMonth() ? s + (byDate.get(isoOf(d))?.length ?? 0) : s,
    0,
  );

  if (total === 0) {
    return (
      <Card>
        <CardContent className="p-10 text-center text-sm text-muted-foreground">
          No hay reservas este mes.
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      {/* Mobile: agenda list */}
      <div className="space-y-3 md:hidden">
        {cells
          .filter((d) => d.getMonth() === cursor.getMonth())
          .map((d) => {
            const items = byDate.get(isoOf(d)) ?? [];
            if (items.length === 0) return null;
            return (
              <div key={isoOf(d)}>
                <button
                  onClick={() => onPickDay(d)}
                  className="mb-1.5 text-sm font-semibold capitalize hover:underline"
                >
                  {dayNamesLong[(d.getDay() + 6) % 7]} {d.getDate()}
                </button>
                <div className="grid gap-2">
                  {items.map((b) => (
                    <BookingChip key={b.id} booking={b} onClick={() => onPickDay(d)} compact />
                  ))}
                </div>
              </div>
            );
          })}
      </div>

      {/* Desktop: month grid */}
      <Card className="hidden overflow-hidden md:block">
        <div className="grid grid-cols-7 border-b bg-muted/30 text-xs font-medium">
          {dayNamesShort.map((n) => (
            <div key={n} className="p-2 text-center">{n}</div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((d, i) => {
            const iso = isoOf(d);
            const items = byDate.get(iso) ?? [];
            const inMonth = d.getMonth() === cursor.getMonth();
            const isToday = iso === today;
            return (
              <button
                key={i}
                onClick={() => onPickDay(d)}
                className={cn(
                  "min-h-[88px] border-b border-r p-1.5 text-left align-top transition-colors hover:bg-muted/50",
                  !inMonth && "bg-muted/20 text-muted-foreground",
                  isToday && "bg-primary/5",
                )}
              >
                <div className="flex items-center justify-between text-xs">
                  <span className={cn("font-medium", isToday && "text-primary")}>
                    {d.getDate()}
                  </span>
                  {items.length > 0 && (
                    <span className="rounded-full bg-primary/10 px-1.5 text-[10px] font-medium text-primary">
                      {items.length}
                    </span>
                  )}
                </div>
                <div className="mt-1 flex flex-wrap gap-0.5">
                  {items.slice(0, 6).map((b) => (
                    <span
                      key={b.id}
                      className={cn("h-1.5 w-1.5 rounded-full", statusDot(b.booking_status))}
                    />
                  ))}
                </div>
              </button>
            );
          })}
        </div>
      </Card>
    </>
  );
}

// ===========================================================================
// Booking chip
// ===========================================================================

function BookingChip({
  booking,
  onClick,
  compact,
}: {
  booking: Booking;
  onClick: () => void;
  compact?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "block w-full rounded-md border bg-card p-3 text-left text-sm transition-colors hover:bg-muted/50",
        booking.booking_status === "cancelled" && "opacity-60",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-medium">
          <span className="tabular-nums">{fmtTime(booking.scheduled_time)}</span>
          <span>·</span>
          <span>{booking.customer_name}</span>
        </div>
        <BookingStatusBadge value={booking.booking_status} />
      </div>
      {!compact && (
        <>
          <div className="mt-1 text-xs text-muted-foreground">
            {booking.service_name} · {booking.vehicle_type}
          </div>
          <div className="text-xs text-muted-foreground">
            {booking.address}, {booking.neighborhood}
          </div>
        </>
      )}
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <PaymentStatusBadge value={booking.payment_status} />
        <BookingSourceBadge value={booking.booking_source} />
      </div>
    </button>
  );
}

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

function statusDot(status: string) {
  switch (status) {
    case "confirmed":
      return "bg-blue-500";
    case "pending":
      return "bg-amber-500";
    case "needs_review":
      return "bg-orange-500";
    case "in_progress":
      return "bg-indigo-500";
    case "completed":
      return "bg-green-500";
    case "cancelled":
      return "bg-red-500";
    default:
      return "bg-muted-foreground";
  }
}
