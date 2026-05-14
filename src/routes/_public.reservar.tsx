import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { toast } from "sonner";
import {
  ArrowLeft,
  ArrowRight,
  Car,
  CheckCircle2,
  Clock,
  Loader2,
  MapPin,
  MessageCircle,
  Sparkles,
  User,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

const WHATSAPP_NUMBER = "5491176247835";
const WHATSAPP_URL = `https://wa.me/${WHATSAPP_NUMBER}`;

// ---------- Types ----------
type Service = {
  id: string;
  name: string;
  description: string | null;
  base_price: number;
  duration_minutes: number;
};
type ServiceArea = { id: string; name: string };
type Slot = {
  id: string;
  date: string;
  start_time: string;
  end_time: string;
  capacity: number;
};

const VEHICLE_TYPES = ["Auto", "SUV", "Pick-up", "Otro"] as const;
const PAYMENT_METHODS = [
  { value: "Pagar después", label: "Pagar después", available: true, hint: "Coordinás con el lavador en el momento." },
  { value: "Transferencia", label: "Transferencia", available: true, hint: "Te enviamos los datos por WhatsApp." },
  { value: "MercadoPago", label: "Mercado Pago", available: false, hint: "Próximamente." },
] as const;

// ---------- Validation ----------
const stepSchemas = {
  customer: z.object({
    customer_name: z.string().trim().min(2, "Ingresá tu nombre completo").max(120),
    customer_phone: z
      .string()
      .trim()
      .min(6, "Ingresá un teléfono válido")
      .max(30)
      .regex(/^[+\d\s\-()]+$/, "Sólo números, espacios y +"),
    customer_email: z.union([z.literal(""), z.string().trim().email("Email inválido").max(255)]),
  }),
  location: z.object({
    address: z.string().trim().min(4, "Ingresá una dirección").max(200),
    neighborhood: z.string().trim().min(2, "Elegí o escribí tu barrio").max(80),
  }),
  vehicle: z.object({
    vehicle_type: z.enum(VEHICLE_TYPES),
    service_id: z.string().uuid("Elegí un servicio"),
  }),
  schedule: z.object({
    scheduled_date: z.string().min(1, "Elegí una fecha"),
    scheduled_time: z.string().min(1, "Elegí un horario"),
  }),
  payment: z.object({
    payment_method: z.enum(["Pagar después", "Transferencia"]),
  }),
};

type FormState = {
  customer_name: string;
  customer_phone: string;
  customer_email: string;
  address: string;
  neighborhood: string;
  vehicle_type: (typeof VEHICLE_TYPES)[number] | "";
  service_id: string;
  scheduled_date: string;
  scheduled_time: string;
  payment_method: "Pagar después" | "Transferencia";
  notes: string;
};

const INITIAL: FormState = {
  customer_name: "",
  customer_phone: "",
  customer_email: "",
  address: "",
  neighborhood: "",
  vehicle_type: "",
  service_id: "",
  scheduled_date: "",
  scheduled_time: "",
  payment_method: "Pagar después",
  notes: "",
};

const STEPS = [
  { id: "customer", label: "Datos", icon: User },
  { id: "location", label: "Ubicación", icon: MapPin },
  { id: "vehicle", label: "Vehículo", icon: Car },
  { id: "schedule", label: "Fecha", icon: Clock },
  { id: "payment", label: "Pago", icon: Sparkles },
  { id: "review", label: "Confirmar", icon: CheckCircle2 },
] as const;

// ---------- Data fetching ----------
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
async function fetchSlots(): Promise<Slot[]> {
  const today = new Date();
  const isoToday = today.toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from("availability_slots")
    .select("id,date,start_time,end_time,capacity")
    .eq("active", true)
    .gte("date", isoToday)
    .order("date")
    .order("start_time")
    .limit(500);
  if (error) throw error;
  return data ?? [];
}

// ---------- Route ----------
export const Route = createFileRoute("/_public/reservar")({
  head: () => ({
    meta: [
      { title: "Reservar lavado — Washero" },
      {
        name: "description",
        content:
          "Reservá tu lavado de auto a domicilio en Zona Norte en pocos pasos. Vamos a tu casa, barrio o empresa.",
      },
    ],
  }),
  component: ReservarPage,
});

// ---------- Helpers ----------
function formatARS(value: number) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(value);
}
function formatDateLong(iso: string) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return new Intl.DateTimeFormat("es-AR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(dt);
}
function formatTime(t: string) {
  return t?.slice(0, 5) ?? "";
}
function normalizePhone(p: string) {
  return p.replace(/\s+/g, " ").trim();
}

// ---------- Page ----------
function ReservarPage() {
  const navigate = useNavigate();
  const [stepIdx, setStepIdx] = useState(0);
  const [form, setForm] = useState<FormState>(INITIAL);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const services = useQuery({ queryKey: ["services"], queryFn: fetchServices, staleTime: 60_000 });
  const areas = useQuery({ queryKey: ["service_areas"], queryFn: fetchAreas, staleTime: 60_000 });
  const slots = useQuery({ queryKey: ["availability_slots"], queryFn: fetchSlots, staleTime: 30_000 });

  const activeAreaNames = useMemo(
    () => new Set((areas.data ?? []).map((a) => a.name.toLowerCase())),
    [areas.data],
  );

  const slotsByDate = useMemo(() => {
    const map = new Map<string, Slot[]>();
    (slots.data ?? []).forEach((s) => {
      if (!map.has(s.date)) map.set(s.date, []);
      map.get(s.date)!.push(s);
    });
    return map;
  }, [slots.data]);

  const availableDates = useMemo(() => Array.from(slotsByDate.keys()), [slotsByDate]);
  const slotsForChosenDate = form.scheduled_date ? slotsByDate.get(form.scheduled_date) ?? [] : [];

  const selectedService = (services.data ?? []).find((s) => s.id === form.service_id);
  const isUnsupportedArea =
    form.neighborhood.trim().length > 0 && !activeAreaNames.has(form.neighborhood.trim().toLowerCase());

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => {
      if (!e[key]) return e;
      const { [key]: _, ...rest } = e;
      return rest;
    });
  };

  const validateStep = (id: (typeof STEPS)[number]["id"]) => {
    if (id === "review") return true;
    const schema = stepSchemas[id as keyof typeof stepSchemas];
    const result = schema.safeParse(form);
    if (result.success) {
      setErrors({});
      return true;
    }
    const errs: Record<string, string> = {};
    result.error.issues.forEach((i) => {
      if (i.path[0]) errs[i.path[0] as string] = i.message;
    });
    setErrors(errs);
    return false;
  };

  const goNext = () => {
    const stepId = STEPS[stepIdx].id;
    if (!validateStep(stepId)) return;
    setStepIdx((i) => Math.min(i + 1, STEPS.length - 1));
  };
  const goBack = () => setStepIdx((i) => Math.max(i - 1, 0));

  async function handleSubmit() {
    if (!selectedService) {
      toast.error("Elegí un servicio");
      setStepIdx(2);
      return;
    }
    setSubmitting(true);

    const payload = {
      customer_name: form.customer_name.trim(),
      customer_phone: normalizePhone(form.customer_phone),
      customer_email: form.customer_email.trim() || null,
      address: form.address.trim(),
      neighborhood: form.neighborhood.trim(),
      vehicle_type: form.vehicle_type as string,
      service_id: selectedService.id,
      scheduled_date: form.scheduled_date,
      scheduled_time: form.scheduled_time,
      payment_method: form.payment_method,
      notes: form.notes.trim() || null,
    };

    const { data, error } = await supabase.functions.invoke("create-website-booking", {
      body: payload,
    });

    type FnResponse = {
      ok: boolean;
      status?: string;
      customer_message?: string;
      booking_status?: "pending" | "needs_review";
      summary?: {
        service_name: string;
        scheduled_date: string;
        scheduled_time: string;
        address: string;
        neighborhood: string;
        price: number;
      };
    };
    const result = (data ?? null) as FnResponse | null;

    if (error || !result?.ok) {
      console.error("Booking creation failed", { error, result });
      setSubmitting(false);
      const msg =
        result?.customer_message ||
        "No pudimos crear la reserva en este momento. Probá de nuevo o escribinos por WhatsApp.";
      toast.error(msg, {
        action: {
          label: "WhatsApp",
          onClick: () => window.open(WHATSAPP_URL, "_blank"),
        },
      });
      return;
    }

    try {
      sessionStorage.setItem(
        "washero:last-booking",
        JSON.stringify({
          service_name: result.summary?.service_name ?? selectedService.name,
          scheduled_date: result.summary?.scheduled_date ?? payload.scheduled_date,
          scheduled_time: result.summary?.scheduled_time ?? payload.scheduled_time,
          address: result.summary?.address ?? payload.address,
          neighborhood: result.summary?.neighborhood ?? payload.neighborhood,
          price: result.summary?.price ?? selectedService.base_price,
          payment_method: payload.payment_method,
          booking_status: result.booking_status ?? "pending",
        }),
      );
    } catch {
      // ignore storage failures
    }

    navigate({ to: "/gracias" });
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:py-12">
      <header className="mb-6 sm:mb-8">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Reservá tu lavado</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          En pocos pasos coordinamos un lavado a domicilio en Zona Norte.
        </p>
      </header>

      <Stepper currentIdx={stepIdx} />

      <Card className="mt-6 border-border/60">
        <CardHeader>
          <CardTitle className="text-lg">{STEPS[stepIdx].label}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {STEPS[stepIdx].id === "customer" && (
            <CustomerStep form={form} errors={errors} update={update} />
          )}
          {STEPS[stepIdx].id === "location" && (
            <LocationStep
              form={form}
              errors={errors}
              update={update}
              areas={areas.data ?? []}
              areasLoading={areas.isLoading}
              areasError={areas.isError}
              isUnsupported={isUnsupportedArea}
            />
          )}
          {STEPS[stepIdx].id === "vehicle" && (
            <VehicleStep
              form={form}
              errors={errors}
              update={update}
              services={services.data ?? []}
              servicesLoading={services.isLoading}
              servicesError={services.isError}
            />
          )}
          {STEPS[stepIdx].id === "schedule" && (
            <ScheduleStep
              form={form}
              errors={errors}
              update={update}
              availableDates={availableDates}
              slotsForChosenDate={slotsForChosenDate}
              slotsLoading={slots.isLoading}
              slotsError={slots.isError}
            />
          )}
          {STEPS[stepIdx].id === "payment" && <PaymentStep form={form} update={update} />}
          {STEPS[stepIdx].id === "review" && (
            <ReviewStep form={form} service={selectedService} isUnsupportedArea={isUnsupportedArea} />
          )}
        </CardContent>
      </Card>

      <div className="mt-6 flex items-center justify-between gap-3">
        <Button variant="ghost" onClick={goBack} disabled={stepIdx === 0 || submitting}>
          <ArrowLeft className="mr-1 h-4 w-4" /> Atrás
        </Button>
        {stepIdx < STEPS.length - 1 ? (
          <Button onClick={goNext} size="lg">
            Continuar <ArrowRight className="ml-1 h-4 w-4" />
          </Button>
        ) : (
          <Button onClick={handleSubmit} size="lg" disabled={submitting}>
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Enviando…
              </>
            ) : (
              <>Confirmar reserva</>
            )}
          </Button>
        )}
      </div>

      <p className="mt-6 text-center text-xs text-muted-foreground">
        ¿Necesitás ayuda?{" "}
        <a href={WHATSAPP_URL} target="_blank" rel="noreferrer" className="underline underline-offset-4">
          Escribinos por WhatsApp
        </a>
      </p>
    </div>
  );
}

// ---------- Stepper ----------
function Stepper({ currentIdx }: { currentIdx: number }) {
  return (
    <ol className="flex items-center gap-1.5 overflow-x-auto pb-1">
      {STEPS.map((s, i) => {
        const Icon = s.icon;
        const active = i === currentIdx;
        const done = i < currentIdx;
        return (
          <li key={s.id} className="flex items-center gap-1.5">
            <div
              className={cn(
                "flex h-8 min-w-8 items-center justify-center rounded-full border text-xs font-semibold transition-colors",
                active && "border-primary bg-primary text-primary-foreground",
                done && "border-primary/40 bg-primary/10 text-primary",
                !active && !done && "border-border bg-muted text-muted-foreground",
              )}
            >
              {done ? <CheckCircle2 className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
            </div>
            {i < STEPS.length - 1 && <div className="h-px w-4 bg-border sm:w-6" />}
          </li>
        );
      })}
    </ol>
  );
}

// ---------- Steps ----------
type StepProps = {
  form: FormState;
  errors: Record<string, string>;
  update: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
};

function FieldError({ msg }: { msg?: string }) {
  if (!msg) return null;
  return <p className="text-xs text-destructive">{msg}</p>;
}

function CustomerStep({ form, errors, update }: StepProps) {
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="customer_name">Nombre completo</Label>
        <Input
          id="customer_name"
          value={form.customer_name}
          onChange={(e) => update("customer_name", e.target.value)}
          placeholder="Juan Pérez"
          autoComplete="name"
        />
        <FieldError msg={errors.customer_name} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="customer_phone">WhatsApp</Label>
        <Input
          id="customer_phone"
          inputMode="tel"
          value={form.customer_phone}
          onChange={(e) => update("customer_phone", e.target.value)}
          placeholder="+54 9 11 1234 5678"
          autoComplete="tel"
        />
        <FieldError msg={errors.customer_phone} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="customer_email">
          Email <span className="text-muted-foreground">(opcional)</span>
        </Label>
        <Input
          id="customer_email"
          type="email"
          value={form.customer_email}
          onChange={(e) => update("customer_email", e.target.value)}
          placeholder="vos@email.com"
          autoComplete="email"
        />
        <FieldError msg={errors.customer_email} />
      </div>
    </div>
  );
}

function LocationStep({
  form,
  errors,
  update,
  areas,
  areasLoading,
  areasError,
  isUnsupported,
}: StepProps & {
  areas: ServiceArea[];
  areasLoading: boolean;
  areasError: boolean;
  isUnsupported: boolean;
}) {
  const [otherMode, setOtherMode] = useState(
    form.neighborhood.length > 0 && !areas.some((a) => a.name === form.neighborhood),
  );

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="address">Dirección</Label>
        <Input
          id="address"
          value={form.address}
          onChange={(e) => update("address", e.target.value)}
          placeholder="Calle, número, piso/depto"
          autoComplete="street-address"
        />
        <FieldError msg={errors.address} />
      </div>
      <div className="space-y-1.5">
        <Label>Barrio o zona</Label>
        {areasError && (
          <p className="text-xs text-destructive">
            No pudimos cargar las zonas. Podés escribirla a mano.
          </p>
        )}
        {!otherMode ? (
          <Select
            value={form.neighborhood}
            onValueChange={(v) => {
              if (v === "__other__") {
                setOtherMode(true);
                update("neighborhood", "");
              } else {
                update("neighborhood", v);
              }
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder={areasLoading ? "Cargando…" : "Elegí tu barrio"} />
            </SelectTrigger>
            <SelectContent>
              {areas.map((a) => (
                <SelectItem key={a.id} value={a.name}>
                  {a.name}
                </SelectItem>
              ))}
              <SelectItem value="__other__">Otra zona…</SelectItem>
            </SelectContent>
          </Select>
        ) : (
          <div className="space-y-2">
            <Input
              value={form.neighborhood}
              onChange={(e) => update("neighborhood", e.target.value)}
              placeholder="Escribí tu barrio o localidad"
            />
            <button
              type="button"
              className="text-xs text-muted-foreground underline underline-offset-4"
              onClick={() => {
                setOtherMode(false);
                update("neighborhood", "");
              }}
            >
              Elegir de la lista
            </button>
          </div>
        )}
        <FieldError msg={errors.neighborhood} />
        {isUnsupported && (
          <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-xs text-foreground">
            Tu zona no está en nuestra cobertura habitual. Vamos a confirmarte por WhatsApp si podemos llegar.
          </div>
        )}
      </div>
    </div>
  );
}

function VehicleStep({
  form,
  errors,
  update,
  services,
  servicesLoading,
  servicesError,
}: StepProps & { services: Service[]; servicesLoading: boolean; servicesError: boolean }) {
  if (servicesLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Cargando servicios…
      </div>
    );
  }
  if (servicesError || services.length === 0) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-destructive">No pudimos cargar los servicios.</p>
        <Button asChild variant="outline">
          <a href={WHATSAPP_URL} target="_blank" rel="noreferrer">
            <MessageCircle className="mr-2 h-4 w-4" /> Escribinos por WhatsApp
          </a>
        </Button>
      </div>
    );
  }
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label>Tipo de vehículo</Label>
        <RadioGroup
          value={form.vehicle_type}
          onValueChange={(v) => update("vehicle_type", v as FormState["vehicle_type"])}
          className="grid grid-cols-2 gap-2 sm:grid-cols-4"
        >
          {VEHICLE_TYPES.map((v) => (
            <Label
              key={v}
              htmlFor={`v-${v}`}
              className={cn(
                "flex cursor-pointer items-center justify-center rounded-md border bg-card p-3 text-sm font-medium transition-colors",
                form.vehicle_type === v && "border-primary ring-2 ring-primary/30",
              )}
            >
              <RadioGroupItem id={`v-${v}`} value={v} className="sr-only" />
              {v}
            </Label>
          ))}
        </RadioGroup>
        <FieldError msg={errors.vehicle_type} />
      </div>

      <Separator />

      <div className="space-y-2">
        <Label>Servicio</Label>
        <RadioGroup
          value={form.service_id}
          onValueChange={(v) => update("service_id", v)}
          className="grid gap-2"
        >
          {services.map((s) => {
            const checked = form.service_id === s.id;
            return (
              <Label
                key={s.id}
                htmlFor={`s-${s.id}`}
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-lg border bg-card p-4 transition-colors",
                  checked && "border-primary ring-2 ring-primary/30",
                )}
              >
                <RadioGroupItem id={`s-${s.id}`} value={s.id} className="mt-1" />
                <div className="flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">{s.name}</span>
                    <span className="font-semibold text-primary">{formatARS(s.base_price)}</span>
                  </div>
                  {s.description && (
                    <p className="mt-1 text-sm text-muted-foreground">{s.description}</p>
                  )}
                  <Badge variant="secondary" className="mt-2">
                    <Clock className="mr-1 h-3 w-3" /> {s.duration_minutes} min
                  </Badge>
                </div>
              </Label>
            );
          })}
        </RadioGroup>
        <FieldError msg={errors.service_id} />
      </div>
    </div>
  );
}

function ScheduleStep({
  form,
  errors,
  update,
  availableDates,
  slotsForChosenDate,
  slotsLoading,
  slotsError,
}: StepProps & {
  availableDates: string[];
  slotsForChosenDate: Slot[];
  slotsLoading: boolean;
  slotsError: boolean;
}) {
  // reset time when date changes to one without that time
  useEffect(() => {
    if (form.scheduled_time && !slotsForChosenDate.some((s) => s.start_time === form.scheduled_time)) {
      update("scheduled_time", "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.scheduled_date]);

  if (slotsLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Cargando disponibilidad…
      </div>
    );
  }
  if (slotsError || availableDates.length === 0) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-destructive">
          No pudimos cargar los horarios disponibles en este momento.
        </p>
        <Button asChild variant="outline">
          <a href={WHATSAPP_URL} target="_blank" rel="noreferrer">
            <MessageCircle className="mr-2 h-4 w-4" /> Coordinemos por WhatsApp
          </a>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label>Fecha</Label>
        <div className="flex flex-wrap gap-2">
          {availableDates.slice(0, 14).map((d) => {
            const active = form.scheduled_date === d;
            return (
              <button
                key={d}
                type="button"
                onClick={() => update("scheduled_date", d)}
                className={cn(
                  "rounded-md border px-3 py-2 text-sm transition-colors",
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "bg-card hover:bg-accent",
                )}
              >
                <span className="block text-xs opacity-80">{formatDateLong(d).split(",")[0]}</span>
                <span className="block font-semibold">
                  {formatDateLong(d).split(",")[1]?.trim() ?? d}
                </span>
              </button>
            );
          })}
        </div>
        <FieldError msg={errors.scheduled_date} />
      </div>

      {form.scheduled_date && (
        <div className="space-y-2">
          <Label>Horario</Label>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {slotsForChosenDate.map((s) => {
              const active = form.scheduled_time === s.start_time;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => update("scheduled_time", s.start_time)}
                  className={cn(
                    "rounded-md border px-2 py-2 text-sm transition-colors",
                    active
                      ? "border-primary bg-primary text-primary-foreground"
                      : "bg-card hover:bg-accent",
                  )}
                >
                  {formatTime(s.start_time)}
                </button>
              );
            })}
          </div>
          <FieldError msg={errors.scheduled_time} />
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Horario de Buenos Aires (GMT-3). Te confirmamos por WhatsApp.
      </p>
    </div>
  );
}

function PaymentStep({
  form,
  update,
}: {
  form: FormState;
  update: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
}) {
  return (
    <div className="space-y-4">
      <Label>Método de pago</Label>
      <RadioGroup
        value={form.payment_method}
        onValueChange={(v) => update("payment_method", v as FormState["payment_method"])}
        className="grid gap-2"
      >
        {PAYMENT_METHODS.map((p) => {
          const checked = form.payment_method === p.value;
          return (
            <Label
              key={p.value}
              htmlFor={`p-${p.value}`}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-lg border bg-card p-4 transition-colors",
                checked && p.available && "border-primary ring-2 ring-primary/30",
                !p.available && "cursor-not-allowed opacity-60",
              )}
            >
              <RadioGroupItem
                id={`p-${p.value}`}
                value={p.value}
                disabled={!p.available}
                className="mt-1"
              />
              <div className="flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">{p.label}</span>
                  {!p.available && <Badge variant="secondary">Próximamente</Badge>}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{p.hint}</p>
              </div>
            </Label>
          );
        })}
      </RadioGroup>

      <Separator />

      <div className="space-y-1.5">
        <Label htmlFor="notes">
          Notas <span className="text-muted-foreground">(opcional)</span>
        </Label>
        <Textarea
          id="notes"
          value={form.notes}
          onChange={(e) => update("notes", e.target.value)}
          placeholder="Color del auto, indicaciones del portero, etc."
          rows={3}
        />
      </div>
    </div>
  );
}

function ReviewStep({
  form,
  service,
  isUnsupportedArea,
}: {
  form: FormState;
  service?: Service;
  isUnsupportedArea: boolean;
}) {
  return (
    <div className="space-y-3 text-sm">
      <Row label="Nombre" value={form.customer_name} />
      <Row label="WhatsApp" value={form.customer_phone} />
      {form.customer_email && <Row label="Email" value={form.customer_email} />}
      <Separator />
      <Row label="Dirección" value={form.address} />
      <Row label="Barrio" value={form.neighborhood} />
      <Separator />
      <Row label="Vehículo" value={form.vehicle_type || "—"} />
      <Row label="Servicio" value={service?.name ?? "—"} />
      <Row label="Fecha" value={formatDateLong(form.scheduled_date)} />
      <Row label="Horario" value={formatTime(form.scheduled_time)} />
      <Separator />
      <Row label="Método de pago" value={form.payment_method} />
      <Row
        label="Total"
        value={service ? <span className="font-semibold text-primary">{formatARS(service.base_price)}</span> : "—"}
      />
      {isUnsupportedArea && (
        <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-xs">
          Tu zona requiere confirmación. La reserva quedará en revisión y te confirmamos por WhatsApp.
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}
