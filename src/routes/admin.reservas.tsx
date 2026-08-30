import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { useQuery } from "@tanstack/react-query";
import { Plus, Search } from "lucide-react";

import { db } from "@/integrations/db/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
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
import {
  type Booking,
  fmtDate,
  fmtTime,
  todayIso,
  BookingDialogs,
} from "@/components/admin/bookings";
import { useQueryClient } from "@tanstack/react-query";
import { Calendar as CalIcon } from "lucide-react";

const reservasSearchSchema = z.object({
  booking: z.string().uuid().optional(),
});

export const Route = createFileRoute("/admin/reservas")({
  validateSearch: reservasSearchSchema,
  component: AdminReservas,
});

type DateFilter = "all" | "today" | "tomorrow" | "week" | "future" | "past";

const addDaysIso = (d: number) => {
  const dt = new Date();
  dt.setDate(dt.getDate() + d);
  return dt.toISOString().slice(0, 10);
};

function AdminReservas() {
  const qc = useQueryClient();
  const urlSearch = Route.useSearch();
  const [search, setSearch] = useState("");
  const [dateFilter, setDateFilter] = useState<DateFilter>("future");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [paymentFilter, setPaymentFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");

  const [selected, setSelected] = useState<Booking | null>(null);
  const [editing, setEditing] = useState<Booking | null>(null);
  const [creating, setCreating] = useState(false);

  const bookingsQuery = useQuery({
    queryKey: ["admin", "bookings", { dateFilter, statusFilter, paymentFilter, sourceFilter }],
    queryFn: async () => {
      let q = db.from("bookings").select("*");

      const today = todayIso();
      if (dateFilter === "today") q = q.eq("scheduled_date", today);
      else if (dateFilter === "tomorrow") q = q.eq("scheduled_date", addDaysIso(1));
      else if (dateFilter === "week")
        q = q.gte("scheduled_date", today).lte("scheduled_date", addDaysIso(7));
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

  useEffect(() => {
    if (!urlSearch.booking) return;
    const found = (bookingsQuery.data ?? []).find((b) => b.id === urlSearch.booking);
    if (found) setSelected(found);
  }, [urlSearch.booking, bookingsQuery.data]);

  const onMutate = () => {
    qc.invalidateQueries({ queryKey: ["admin", "bookings"] });
    qc.invalidateQueries({ queryKey: ["admin", "metrics"] });
  };

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
                  <TableRow key={b.id} className="cursor-pointer" onClick={() => setSelected(b)}>
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

      <BookingDialogs
        selected={selected}
        setSelected={setSelected}
        editing={editing}
        setEditing={setEditing}
        creating={creating}
        setCreating={setCreating}
        onMutate={onMutate}
      />
    </div>
  );
}
