import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { toast } from "sonner";
import { ArrowLeft, ChevronLeft, ChevronRight, Loader2, MessageCircle } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PlacesAutocomplete, type PlaceSelection } from "@/components/PlacesAutocomplete";
import { cn } from "@/lib/utils";

const WHATSAPP_NUMBER = "5491176247835";
const WHATSAPP_URL = `https://wa.me/${WHATSAPP_NUMBER}`;

// ----- Constants (mirror server allowlist) -----
const VEHICLE_OPTIONS = [
  { value: "Auto", label: "Auto chico", surcharge: 0, hint: "Sin cargo" },
  { value: "SUV", label: "SUV / Crossover", surcharge: 5000, hint: "+ $5.000" },
  { value: "Pick-up", label: "Pick Up / Van", surcharge: 8000, hint: "+ $8.000" },
] as const;

const EXTRAS = [
  { key: "encerado_rapido", label: "Encerado rápido", price: 8000 },
  { key: "detallado_interior_profundo", label: "Detallado interior profundo", price: 9000 },
  { key: "eliminacion_olores", label: "Eliminación de olores", price: 12000 },
  { key: "barro_auto_muy_sucio", label: "Barro / Auto muy sucio", price: 7000 },
  { key: "pelo_mascotas", label: "Pelo de mascotas", price: 10000 },
] as const;

const PAYMENTS = [
  { value: "MercadoPago", label: "Mercado Pago", hint: "Online seguro" },
  { value: "Transferencia", label: "Transferencia", hint: "Te enviamos los datos" },
  { value: "Pagar después", label: "Pagar después", hint: "En el lugar" },
] as const;

const OTHER_AREA = "__other__";

// ----- Types -----
type Service = { id: string; name: string; description: string | null; base_price: number; duration_minutes: number };
type ServiceArea = { id: string; name: string };
type PublicSlot = { id: string; date: string; start_time: string; end_time: string; capacity: number; taken: number; remaining: number };

type FormState = {
  service_id: string;
  vehicle_type: "Auto" | "SUV" | "Pick-up" | "";
  extras: string[];
  address: string;
  neighborhood_choice: string; // dropdown value (area name or OTHER_AREA)
  neighborhood_other: string;
  customer_name: string;
  customer_phone: string;
  customer_email: string;
  notes: string;
  whatsapp_reminders: boolean;
  kipper_quote: boolean;
  payment_method: "MercadoPago" | "Transferencia" | "Pagar después";
};

const INITIAL: FormState = {
  service_id: "",
  vehicle_type: "",
  extras: [],
  address: "",
  neighborhood_choice: "",
  neighborhood_other: "",
  customer_name: "",
  customer_phone: "",
  customer_email: "",
  notes: "",
  whatsapp_reminders: false,
  kipper_quote: false,
  payment_method: "MercadoPago",
};

const formSchema = z.object({
  service_id: z.string().uuid("Elegí un servicio"),
  vehicle_type: z.enum(["Auto", "SUV", "Pick-up"]),
  address: z.string().trim().min(4, "Ingresá una dirección"),
  neighborhood: z.string().trim().min(2, "Elegí o escribí tu zona"),
  customer_name: z.string().trim().min(2, "Ingresá tu nombre"),
  customer_phone: z.string().trim().min(6, "Teléfono inválido").regex(/^[+\d\s\-()]+$/, "Sólo números, espacios y +"),
  customer_email: z.union([z.literal(""), z.string().trim().email("Email inválido")]),
});

// ----- Helpers -----
const MONTHS_ES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
const WEEKDAYS_ES = ["Dom","Lun","Mar","Mié","Jue","Vie","Sáb"];
const WEEKDAYS_LONG = ["Domingo","Lunes","Martes","Miércoles","Jueves","Viernes","Sábado"];

function formatARS(v: number) {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(v);
}
function isoFromDate(d: Date) {
  const y = d.getFullYear(); const m = String(d.getMonth()+1).padStart(2,"0"); const day = String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${day}`;
}
function dateFromIso(iso: string) {
  const [y,m,d] = iso.split("-").map(Number);
  return new Date(y, m-1, d);
}
function formatDayLong(iso: string) {
  const d = dateFromIso(iso);
  return `${WEEKDAYS_LONG[d.getDay()]} ${d.getDate()} de ${MONTHS_ES[d.getMonth()].toLowerCase()}`;
}

// ----- Data fetching -----
async function fetchServices(): Promise<Service[]> {
  const { data, error } = await supabase
    .from("services")
    .select("id,name,description,base_price,duration_minutes")
    .eq("active", true)
    .order("base_price");
  if (error) throw error;
  return data ?? [];
}
async function fetchAreas(): Promise<ServiceArea[]> {
  const { data, error } = await supabase
    .from("service_areas")
    .select("id,name")
    .eq("active", true)
    .order("name");
  if (error) throw error;
  return data ?? [];
}
async function fetchAvailability(): Promise<PublicSlot[]> {
  const { data, error } = await supabase.functions.invoke("get-public-availability");
  if (error) throw error;
  const body = data as { ok: boolean; slots?: PublicSlot[] } | null;
  if (!body?.ok) throw new Error("availability_failed");
  return body.slots ?? [];
}

// ----- Route -----
export const Route = createFileRoute("/_public/reservar")({
  head: () => ({
    meta: [
      { title: "Reservar lavado — Washero" },
      { name: "description", content: "Reservá tu lavado de auto a domicilio en Zona Norte. Elegí día y horario en pocos toques." },
    ],
  }),
  component: ReservarPage,
});

// ============ Page ============
function ReservarPage() {
  const navigate = useNavigate();

  const services = useQuery({ queryKey: ["services"], queryFn: fetchServices, staleTime: 60_000 });
  const areas = useQuery({ queryKey: ["service_areas"], queryFn: fetchAreas, staleTime: 60_000 });
  const availability = useQuery({ queryKey: ["public_availability"], queryFn: fetchAvailability, staleTime: 30_000, retry: 1 });

  // Group slots by date
  const slotsByDate = useMemo(() => {
    const map = new Map<string, PublicSlot[]>();
    for (const s of availability.data ?? []) {
      if (!map.has(s.date)) map.set(s.date, []);
      map.get(s.date)!.push(s);
    }
    return map;
  }, [availability.data]);

  const datesWithAvailability = useMemo(() => {
    const out = new Set<string>();
    for (const [date, list] of slotsByDate.entries()) {
      if (list.some((s) => s.remaining > 0)) out.add(date);
    }
    return out;
  }, [slotsByDate]);

  // Calendar month state
  const today = useMemo(() => {
    const t = new Date(); t.setHours(0,0,0,0); return t;
  }, []);
  const [viewMonth, setViewMonth] = useState<Date>(() => {
    const t = new Date(); return new Date(t.getFullYear(), t.getMonth(), 1);
  });

  // Selected date / time
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [timeSheetOpen, setTimeSheetOpen] = useState(false);
  const [bookingOpen, setBookingOpen] = useState(false);

  const slotsForSelected = selectedDate ? (slotsByDate.get(selectedDate) ?? []) : [];

  function openDay(iso: string) {
    setSelectedDate(iso);
    setSelectedTime(null);
    setTimeSheetOpen(true);
  }
  function pickTime(time: string) {
    setSelectedTime(time);
    setTimeSheetOpen(false);
    setBookingOpen(true);
  }
  function backToTimes() {
    setBookingOpen(false);
    setTimeSheetOpen(true);
  }

  return (
    <div className="mx-auto max-w-xl px-4 py-8 sm:py-12">
      <header className="mb-6 sm:mb-8 text-center sm:text-left">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Reservá tu lavado</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Elegí día y horario. Después completás los datos de tu auto y ubicación.
        </p>
      </header>

      <CalendarCard
        viewMonth={viewMonth}
        setViewMonth={setViewMonth}
        today={today}
        datesWithAvailability={datesWithAvailability}
        selectedDate={selectedDate}
        onPickDay={openDay}
        loading={availability.isLoading}
        error={availability.isError}
      />

      <p className="mt-6 text-center text-xs text-muted-foreground">
        ¿Necesitás ayuda?{" "}
        <a href={WHATSAPP_URL} target="_blank" rel="noreferrer" className="underline underline-offset-4 inline-flex items-center gap-1">
          <MessageCircle className="h-3 w-3" /> Escribinos por WhatsApp
        </a>
      </p>

      {/* Time selector */}
      <Sheet open={timeSheetOpen} onOpenChange={setTimeSheetOpen}>
        <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto rounded-t-2xl sm:max-w-lg sm:mx-auto">
          <SheetHeader className="text-left">
            <SheetTitle>Horarios disponibles</SheetTitle>
            <SheetDescription className="capitalize">
              {selectedDate ? formatDayLong(selectedDate) : ""}
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4">
            {slotsForSelected.length === 0 && (
              <p className="col-span-full text-sm text-muted-foreground">
                No quedan horarios disponibles para este día.
              </p>
            )}
            {slotsForSelected.map((s) => {
              const time = s.start_time.slice(0,5);
              const disabled = s.remaining <= 0;
              return (
                <Button
                  key={s.id}
                  variant="outline"
                  disabled={disabled}
                  onClick={() => pickTime(time)}
                  className="h-12 text-base font-semibold"
                >
                  {time}
                </Button>
              );
            })}
          </div>
        </SheetContent>
      </Sheet>

      {/* Booking modal */}
      <Dialog open={bookingOpen} onOpenChange={setBookingOpen}>
        <DialogContent className="max-w-[620px] max-h-[90vh] overflow-y-auto p-0">
          {selectedDate && selectedTime && (
            <BookingForm
              services={services.data ?? []}
              servicesLoading={services.isLoading}
              areas={areas.data ?? []}
              date={selectedDate}
              time={selectedTime}
              onBack={backToTimes}
              onClose={() => setBookingOpen(false)}
              onSuccess={(checkoutUrl, summary) => {
                try { sessionStorage.setItem("washero:last-booking", JSON.stringify(summary)); } catch {}
                if (checkoutUrl) {
                  window.location.assign(checkoutUrl);
                  return;
                }
                navigate({ to: "/gracias" });
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ============ Calendar Card ============
function CalendarCard({
  viewMonth, setViewMonth, today, datesWithAvailability, selectedDate, onPickDay, loading, error,
}: {
  viewMonth: Date;
  setViewMonth: (d: Date) => void;
  today: Date;
  datesWithAvailability: Set<string>;
  selectedDate: string | null;
  onPickDay: (iso: string) => void;
  loading: boolean;
  error: boolean;
}) {
  const year = viewMonth.getFullYear();
  const month = viewMonth.getMonth();
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells: Array<{ iso: string; day: number } | null> = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(year, month, d);
    cells.push({ iso: isoFromDate(date), day: d });
  }
  while (cells.length % 7 !== 0) cells.push(null);

  const canGoPrev = new Date(year, month, 1) > new Date(today.getFullYear(), today.getMonth(), 1);

  return (
    <div className="rounded-2xl border border-border/60 bg-card p-4 sm:p-6 shadow-sm">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="icon" onClick={() => setViewMonth(new Date(year, month - 1, 1))} disabled={!canGoPrev} aria-label="Mes anterior">
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <h2 className="text-base font-semibold">
          {MONTHS_ES[month]} {year}
        </h2>
        <Button variant="ghost" size="icon" onClick={() => setViewMonth(new Date(year, month + 1, 1))} aria-label="Mes siguiente">
          <ChevronRight className="h-5 w-5" />
        </Button>
      </div>

      <div className="mt-4 grid grid-cols-7 gap-1 text-center text-xs font-medium text-muted-foreground">
        {WEEKDAYS_ES.map((w) => (
          <div key={w} className="py-1">{w}</div>
        ))}
      </div>

      {error ? (
        <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          No pudimos cargar los horarios disponibles. Probá de nuevo o{" "}
          <a href={WHATSAPP_URL} target="_blank" rel="noreferrer" className="underline">escribinos por WhatsApp</a>.
        </div>
      ) : loading ? (
        <div className="mt-4 grid grid-cols-7 gap-1">
          {Array.from({ length: 35 }).map((_, i) => (
            <div key={i} className="aspect-square rounded-md bg-muted/40 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="mt-1 grid grid-cols-7 gap-1">
          {cells.map((c, idx) => {
            if (!c) return <div key={idx} className="aspect-square" />;
            const date = dateFromIso(c.iso);
            const isPast = date < today;
            const hasAvail = datesWithAvailability.has(c.iso);
            const isSelected = selectedDate === c.iso;
            const disabled = isPast || !hasAvail;
            return (
              <button
                key={idx}
                type="button"
                disabled={disabled}
                onClick={() => onPickDay(c.iso)}
                className={cn(
                  "relative aspect-square rounded-lg text-sm font-medium transition-colors",
                  disabled && "text-muted-foreground/40 cursor-not-allowed",
                  !disabled && "hover:bg-primary/10 text-foreground",
                  isSelected && "border-2 border-primary bg-primary/10",
                )}
              >
                {c.day}
                {hasAvail && !disabled && (
                  <span className="absolute bottom-1 left-1/2 -translate-x-1/2 h-1 w-1 rounded-full bg-primary" />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ============ Booking Form ============
function BookingForm({
  services, servicesLoading, areas, date, time, onBack, onClose, onSuccess,
}: {
  services: Service[];
  servicesLoading: boolean;
  areas: ServiceArea[];
  date: string;
  time: string;
  onBack: () => void;
  onClose: () => void;
  onSuccess: (checkoutUrl: string | null, summary: any) => void;
}) {
  const [form, setForm] = useState<FormState>(INITIAL);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  // Auto-select first service
  useEffect(() => {
    if (!form.service_id && services.length > 0) {
      setForm((f) => ({ ...f, service_id: services[0].id }));
    }
  }, [services, form.service_id]);

  const update = <K extends keyof FormState>(k: K, v: FormState[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => { const { [k]: _, ...rest } = e as any; return rest; });
  };

  const selectedService = services.find((s) => s.id === form.service_id);
  const vehicleSurcharge = VEHICLE_OPTIONS.find((v) => v.value === form.vehicle_type)?.surcharge ?? 0;
  const extrasTotal = form.extras.reduce((sum, k) => sum + (EXTRAS.find((e) => e.key === k)?.price ?? 0), 0);
  const basePrice = selectedService?.base_price ?? 0;
  const total = basePrice + vehicleSurcharge + extrasTotal;

  const neighborhood = form.neighborhood_choice === OTHER_AREA
    ? form.neighborhood_other
    : form.neighborhood_choice;

  function toggleExtra(key: string) {
    setForm((f) => ({
      ...f,
      extras: f.extras.includes(key) ? f.extras.filter((k) => k !== key) : [...f.extras, key],
    }));
  }

  async function submit() {
    const candidate = {
      service_id: form.service_id,
      vehicle_type: form.vehicle_type,
      address: form.address,
      neighborhood,
      customer_name: form.customer_name,
      customer_phone: form.customer_phone,
      customer_email: form.customer_email,
    };
    const result = formSchema.safeParse(candidate);
    if (!result.success) {
      const errs: Record<string, string> = {};
      result.error.issues.forEach((i) => { if (i.path[0]) errs[i.path[0] as string] = i.message; });
      setErrors(errs);
      return;
    }

    setSubmitting(true);
    const noteParts: string[] = [];
    if (form.notes.trim()) noteParts.push(form.notes.trim());
    if (form.whatsapp_reminders) noteParts.push("Recordatorios WhatsApp: sí");
    if (form.kipper_quote) noteParts.push("Interés en cotización Kipper Seguros: sí");

    const payload = {
      customer_name: form.customer_name.trim(),
      customer_phone: form.customer_phone.trim(),
      customer_email: form.customer_email.trim() || null,
      address: form.address.trim(),
      neighborhood: neighborhood.trim(),
      vehicle_type: form.vehicle_type,
      service_id: form.service_id,
      scheduled_date: date,
      scheduled_time: time,
      payment_method: form.payment_method,
      notes: noteParts.join(" · ") || null,
      selected_extras: form.extras,
    };

    const { data, error } = await supabase.functions.invoke("create-website-booking", { body: payload });
    type Resp = { ok: boolean; customer_message?: string; checkout_url?: string | null; summary?: any; booking_status?: string };
    const res = (data ?? null) as Resp | null;

    if (error || !res?.ok) {
      setSubmitting(false);
      const msg = res?.customer_message ?? "No pudimos crear la reserva. Probá de nuevo o escribinos por WhatsApp.";
      toast.error(msg, {
        action: { label: "WhatsApp", onClick: () => window.open(WHATSAPP_URL, "_blank") },
      });
      return;
    }

    onSuccess(res.checkout_url ?? null, {
      ...(res.summary ?? {}),
      payment_method: payload.payment_method,
      booking_status: res.booking_status ?? "pending",
    });
  }

  const requiredOk =
    !!form.service_id &&
    !!form.vehicle_type &&
    form.address.trim().length >= 4 &&
    neighborhood.trim().length >= 2 &&
    form.customer_name.trim().length >= 2 &&
    form.customer_phone.trim().length >= 6;

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background border-b px-5 py-4">
        <div className="flex items-center justify-between gap-2">
          <button onClick={onBack} className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
            <ArrowLeft className="h-4 w-4" /> Cambiar horario
          </button>
        </div>
        <h2 className="mt-2 text-lg font-semibold">Completá tu reserva</h2>
        <p className="text-sm text-muted-foreground capitalize">
          {formatDayLong(date)} · {time} hs
        </p>
      </div>

      <div className="px-5 py-4 space-y-6">
        {/* Servicio */}
        <Section title="Servicio">
          {servicesLoading ? (
            <div className="text-sm text-muted-foreground">Cargando…</div>
          ) : (
            <div className="space-y-2">
              {services.map((s) => {
                const active = form.service_id === s.id;
                return (
                  <button
                    key={s.id} type="button"
                    onClick={() => update("service_id", s.id)}
                    className={cn(
                      "w-full text-left rounded-xl border p-3 transition-colors",
                      active ? "border-primary border-2 bg-primary/5" : "border-border hover:bg-muted/50",
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold">{s.name}</div>
                        {s.description && <div className="text-xs text-muted-foreground mt-0.5">{s.description}</div>}
                        <div className="text-xs text-muted-foreground mt-1">{s.duration_minutes} min</div>
                      </div>
                      <div className="text-sm font-semibold whitespace-nowrap">{formatARS(s.base_price)}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </Section>

        {/* Vehículo */}
        <Section title="Tamaño del vehículo">
          <div className="grid gap-2 sm:grid-cols-3">
            {VEHICLE_OPTIONS.map((v) => {
              const active = form.vehicle_type === v.value;
              return (
                <button
                  key={v.value} type="button"
                  onClick={() => update("vehicle_type", v.value)}
                  className={cn(
                    "rounded-xl border p-3 text-left transition-colors",
                    active ? "border-primary border-2 bg-primary/5" : "border-border hover:bg-muted/50",
                  )}
                >
                  <div className="font-medium text-sm">{v.label}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{v.hint}</div>
                </button>
              );
            })}
          </div>
        </Section>

        {/* Extras */}
        <Section title="Extras opcionales" subtitle="Sumá los que necesites">
          <div className="space-y-2">
            {EXTRAS.map((e) => {
              const active = form.extras.includes(e.key);
              return (
                <label
                  key={e.key}
                  className={cn(
                    "flex items-center justify-between gap-3 rounded-xl border p-3 cursor-pointer transition-colors",
                    active ? "border-primary border-2 bg-primary/5" : "border-border hover:bg-muted/50",
                  )}
                >
                  <div className="flex items-center gap-3">
                    <Checkbox checked={active} onCheckedChange={() => toggleExtra(e.key)} />
                    <span className="text-sm font-medium">{e.label}</span>
                  </div>
                  <span className="text-sm font-semibold">{formatARS(e.price)}</span>
                </label>
              );
            })}
          </div>
        </Section>

        {/* Dirección */}
        <Section title="Dirección">
          <Input
            placeholder="Ej: Av. Corrientes 1234, CABA"
            value={form.address}
            onChange={(e) => update("address", e.target.value)}
          />
          <FieldError msg={errors.address} />
        </Section>

        {/* Zona */}
        <Section title="Barrio / Zona">
          <Select
            value={form.neighborhood_choice}
            onValueChange={(v) => update("neighborhood_choice", v)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Seleccioná tu barrio o zona" />
            </SelectTrigger>
            <SelectContent>
              {areas.map((a) => (
                <SelectItem key={a.id} value={a.name}>{a.name}</SelectItem>
              ))}
              <SelectItem value={OTHER_AREA}>Otra zona</SelectItem>
            </SelectContent>
          </Select>
          {form.neighborhood_choice === OTHER_AREA && (
            <Input
              className="mt-2"
              placeholder="Escribí tu barrio o zona"
              value={form.neighborhood_other}
              onChange={(e) => update("neighborhood_other", e.target.value)}
            />
          )}
          <FieldError msg={errors.neighborhood} />
        </Section>

        {/* Contacto */}
        <Section title="Datos de contacto">
          <div className="space-y-3">
            <div>
              <Label htmlFor="cn">Nombre completo</Label>
              <Input id="cn" value={form.customer_name} onChange={(e) => update("customer_name", e.target.value)} placeholder="Juan Pérez" />
              <FieldError msg={errors.customer_name} />
            </div>
            <div>
              <Label htmlFor="cp">Teléfono</Label>
              <Input id="cp" inputMode="tel" value={form.customer_phone} onChange={(e) => update("customer_phone", e.target.value)} placeholder="+54 9 11 ..." />
              <FieldError msg={errors.customer_phone} />
            </div>
            <div>
              <Label htmlFor="ce">Email <span className="text-muted-foreground text-xs">(opcional)</span></Label>
              <Input id="ce" type="email" value={form.customer_email} onChange={(e) => update("customer_email", e.target.value)} placeholder="vos@email.com" />
              <FieldError msg={errors.customer_email} />
            </div>
          </div>
        </Section>

        {/* Notas */}
        <Section title="Notas adicionales">
          <Textarea
            value={form.notes}
            onChange={(e) => update("notes", e.target.value)}
            placeholder="Acceso, color del auto, instrucciones..."
            rows={3}
          />
          <label className="mt-3 flex items-center gap-2 text-sm cursor-pointer">
            <Checkbox checked={form.whatsapp_reminders} onCheckedChange={(v) => update("whatsapp_reminders", !!v)} />
            Recibir recordatorios por WhatsApp
          </label>
        </Section>

        {/* Kipper */}
        <label
          className={cn(
            "block rounded-xl border p-3 cursor-pointer transition-colors",
            form.kipper_quote ? "border-primary border-2 bg-primary/5" : "border-border hover:bg-muted/50",
          )}
        >
          <div className="flex items-start gap-3">
            <Checkbox checked={form.kipper_quote} onCheckedChange={(v) => update("kipper_quote", !!v)} className="mt-0.5" />
            <div>
              <div className="text-sm font-medium">
                Quiero recibir una cotización de seguro con Kipper Seguros y acceder a beneficios exclusivos.
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                Sin compromiso. Te contactamos para ofrecerte descuentos especiales en Washero.
              </div>
            </div>
          </div>
        </label>

        {/* Pago */}
        <Section title="Método de pago">
          <div className="grid gap-2">
            {PAYMENTS.map((p) => {
              const active = form.payment_method === p.value;
              return (
                <button
                  key={p.value} type="button"
                  onClick={() => update("payment_method", p.value as FormState["payment_method"])}
                  className={cn(
                    "rounded-xl border p-3 text-left transition-colors",
                    active ? "border-primary border-2 bg-primary/5" : "border-border hover:bg-muted/50",
                  )}
                >
                  <div className="font-medium text-sm">{p.label}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{p.hint}</div>
                </button>
              );
            })}
          </div>
        </Section>

        {/* Resumen */}
        <div className="rounded-xl border bg-muted/30 p-4 space-y-1.5 text-sm">
          <div className="flex justify-between"><span>Servicio base</span><span>{formatARS(basePrice)}</span></div>
          <div className="flex justify-between"><span>Vehículo</span><span>{formatARS(vehicleSurcharge)}</span></div>
          <div className="flex justify-between"><span>Extras</span><span>{formatARS(extrasTotal)}</span></div>
          <div className="border-t pt-1.5 flex justify-between font-semibold text-base">
            <span>Total</span><span>{formatARS(total)}</span>
          </div>
          <p className="text-[10px] text-muted-foreground pt-1">
            El precio final se confirma del lado del servidor.
          </p>
        </div>
      </div>

      {/* Sticky CTA */}
      <div className="sticky bottom-0 bg-background border-t px-5 py-3">
        <Button
          className="w-full"
          size="lg"
          disabled={!requiredOk || submitting}
          onClick={submit}
        >
          {submitting ? (
            <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Enviando…</>
          ) : form.payment_method === "MercadoPago" ? (
            <>Pagar con Mercado Pago →</>
          ) : (
            <>Confirmar reserva →</>
          )}
        </Button>
      </div>
    </div>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-sm font-semibold mb-2">{title}</h3>
      {subtitle && <p className="text-xs text-muted-foreground mb-2 -mt-1">{subtitle}</p>}
      {children}
    </div>
  );
}

function FieldError({ msg }: { msg?: string }) {
  if (!msg) return null;
  return <p className="text-xs text-destructive mt-1">{msg}</p>;
}
