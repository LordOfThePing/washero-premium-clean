import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Loader2,
  MapPin,
  MessageCircle,
  ShieldAlert,
  Sparkles,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { PlacesAutocomplete, type PlaceSelection } from "@/components/PlacesAutocomplete";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import type { BookingAttribution } from "@/lib/attribution";
import {
  COVERAGE_COPY,
  INITIAL_FORM,
  PAYMENTS,
  VEHICLE_CODE_TO_TYPE,
  WHATSAPP_URL,
  contactSchema,
  fetchLogisticAvailability,
  fetchPricing,
  fetchServices,
  filterTooSoonSlots,
  formatARS,
  formatDayLong,
  formatDayShort,
  isoFromDate,
  type FormState,
  type LogisticSlot,
} from "@/components/reservar/shared";

type CoverageState =
  | { kind: "idle" }
  | { kind: "validating" }
  | { kind: "ok"; zone_id: string | null; zone_name: string }
  | { kind: "outside" }
  | { kind: "error"; message: string };

type SlotPick = { date: string; time: string; slot_id: string; reason?: string };

const STEPS = ["Dirección", "Servicio", "Horario", "Datos y pago"] as const;
const RECOMMENDED_SCORE_MIN = 70;

export function AddressFirstFlow({ attribution }: { attribution?: BookingAttribution }) {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [place, setPlace] = useState<PlaceSelection | null>(null);
  const [coverage, setCoverage] = useState<CoverageState>({ kind: "idle" });
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [pick, setPick] = useState<SlotPick | null>(null);
  const [focusDate, setFocusDate] = useState<string>(() => isoFromDate(new Date()));
  const [showOtherSlots, setShowOtherSlots] = useState(false);

  const services = useQuery({ queryKey: ["services"], queryFn: fetchServices, staleTime: 60_000 });
  const pricing = useQuery({ queryKey: ["pricing_items"], queryFn: fetchPricing, staleTime: 60_000 });

  const selectedService = services.data?.find((s) => s.id === form.service_id);
  const vehicleDurationMinutes = useMemo(() => {
    const item = (pricing.data ?? []).find(
      (p) => p.type === "vehicle_surcharge" && p.code === form.vehicle_code,
    );
    return Math.max(0, item?.duration_minutes ?? 0);
  }, [pricing.data, form.vehicle_code]);
  const extrasDurationMinutes = useMemo(
    () =>
      form.extras.reduce(
        (sum, code) =>
          sum +
          Math.max(
            0,
            (pricing.data ?? []).find((p) => p.type === "extra" && p.code === code)?.duration_minutes ?? 0,
          ),
        0,
      ),
    [pricing.data, form.extras],
  );
  const estimatedDurationMinutes = Math.max(
    0,
    (selectedService?.duration_minutes ?? 0) + vehicleDurationMinutes + extrasDurationMinutes,
  );

  const logisticEnabled =
    coverage.kind === "ok" &&
    place?.lat != null &&
    place?.lng != null &&
    !!form.service_id &&
    estimatedDurationMinutes > 0;

  const logistic = useQuery({
    queryKey: [
      "logistic_availability",
      place?.lat,
      place?.lng,
      coverage.kind === "ok" ? coverage.zone_id : null,
      coverage.kind === "ok" ? coverage.zone_name : null,
      form.service_id,
      form.vehicle_code,
      form.extras.slice().sort().join("|"),
      estimatedDurationMinutes,
    ],
    queryFn: () =>
      fetchLogisticAvailability({
        address_lat: place!.lat!,
        address_lng: place!.lng!,
        coverage_zone_id: coverage.kind === "ok" ? coverage.zone_id : null,
        coverage_zone_name: coverage.kind === "ok" ? coverage.zone_name : "",
        service_id: form.service_id,
        duration_minutes: estimatedDurationMinutes,
        debug: import.meta.env.DEV,
      }),
    enabled: logisticEnabled,
    staleTime: 30_000,
  });

  const vehicles = useMemo(
    () =>
      (pricing.data ?? [])
        .filter((p) => p.type === "vehicle_surcharge")
        .sort((a, b) => a.display_order - b.display_order),
    [pricing.data],
  );
  const extras = useMemo(
    () =>
      (pricing.data ?? [])
        .filter((p) => p.type === "extra")
        .sort((a, b) => a.display_order - b.display_order),
    [pricing.data],
  );

  useEffect(() => {
    if (!form.service_id && (services.data?.length ?? 0) > 0) {
      setForm((f) => ({ ...f, service_id: services.data![0].id }));
    }
  }, [services.data, form.service_id]);

  useEffect(() => {
    if (!form.vehicle_code && vehicles.length > 0) {
      setForm((f) => ({ ...f, vehicle_code: vehicles[0].code }));
    }
  }, [vehicles, form.vehicle_code]);

  useEffect(() => {
    setPick(null);
  }, [form.service_id, form.vehicle_code, form.extras]);

  useEffect(() => {
    if (!place) {
      setCoverage({ kind: "idle" });
      return;
    }
    let cancelled = false;
    setCoverage({ kind: "validating" });
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke("validate-address-location", {
          body: {
            place_id: place.place_id,
            formatted_address: place.formatted_address,
            lat: place.lat,
            lng: place.lng,
            neighborhood: place.neighborhood,
          },
        });
        if (cancelled) return;
        type Resp = { ok: boolean; inside_coverage: boolean; zone: { id: string; name: string } | null };
        const res = (data ?? null) as Resp | null;
        if (error || !res?.ok) {
          setCoverage({
            kind: "error",
            message: "No pudimos validar la dirección. Probá nuevamente o escribinos por WhatsApp.",
          });
          return;
        }
        if (res.inside_coverage && res.zone) {
          setCoverage({ kind: "ok", zone_id: res.zone.id, zone_name: res.zone.name });
        } else {
          setCoverage({ kind: "outside" });
        }
      } catch {
        if (!cancelled) {
          setCoverage({
            kind: "error",
            message: "No pudimos validar la dirección. Probá nuevamente o escribinos por WhatsApp.",
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [place]);

  const days = useMemo(
    () =>
      (logistic.data ?? [])
        .map((day) => ({
          ...day,
          recommended_slots: filterTooSoonSlots(day.recommended_slots),
          other_slots: filterTooSoonSlots(day.other_slots),
        }))
        .filter((day) => day.recommended_slots.length > 0 || day.other_slots.length > 0),
    [logistic.data],
  );

  useEffect(() => {
    if (days.length === 0) return;
    if (!days.some((d) => d.date === focusDate)) {
      setFocusDate(days[0].date);
    }
  }, [days, focusDate]);

  useEffect(() => {
    setShowOtherSlots(false);
  }, [focusDate]);

  useEffect(() => {
    if (!import.meta.env.DEV || !logistic.data || !place || coverage.kind !== "ok") return;
    const firstDay = logistic.data[0];
    console.log("[Reservar][logistic-debug]", {
      address_lat: place.lat,
      address_lng: place.lng,
      coverage_zone_id: coverage.zone_id,
      coverage_zone_name: coverage.zone_name,
      duration_minutes: estimatedDurationMinutes,
      days_returned: logistic.data.length,
      first_day: firstDay?.date ?? null,
      first_day_recommended_count: firstDay?.recommended_slots.length ?? 0,
      first_day_other_count: firstDay?.other_slots.length ?? 0,
    });
  }, [coverage, estimatedDurationMinutes, logistic.data, place]);

  const daySummaries = useMemo(
    () =>
      days.map((day) => {
        const totalSlots = day.recommended_slots.length + day.other_slots.length;
        const hasRecommended = day.recommended_slots.some((slot) => slot.score >= RECOMMENDED_SCORE_MIN);
        return {
          date: day.date,
          totalSlots,
          hasRecommended,
        };
      }),
    [days],
  );

  const focusDay = days.find((d) => d.date === focusDate);
  const recommendedForFocus = focusDay?.recommended_slots ?? [];
  const otherForFocus = focusDay?.other_slots ?? [];

  const selectedVehicle = vehicles.find((v) => v.code === form.vehicle_code);
  const vehicleSurcharge = selectedVehicle?.amount ?? 0;
  const extrasTotal = form.extras.reduce(
    (sum, code) => sum + (extras.find((e) => e.code === code)?.amount ?? 0),
    0,
  );
  const total = (selectedService?.base_price ?? 0) + vehicleSurcharge + extrasTotal;

  const update = <K extends keyof FormState>(k: K, v: FormState[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => {
      const { [k]: _, ...rest } = e as Record<string, string>;
      return rest;
    });
  };

  function toggleExtra(code: string) {
    setForm((f) => ({
      ...f,
      extras: f.extras.includes(code) ? f.extras.filter((c) => c !== code) : [...f.extras, code],
    }));
  }

  function selectSlot(slot: LogisticSlot) {
    setPick({
      date: slot.date,
      time: slot.start_time,
      slot_id: slot.slot_id,
      reason: slot.reason,
    });
  }

  function goToServiceStep() {
    if (coverage.kind !== "ok" || !place) {
      toast.error("Validá tu dirección dentro de la zona de cobertura.");
      return;
    }
    setStep(1);
  }

  function goToSlotsStep() {
    if (!form.service_id) {
      toast.error("Elegí un servicio para ver horarios.");
      return;
    }
    if (!form.vehicle_code) {
      toast.error("Elegí el tamaño de tu vehículo.");
      return;
    }
    setPick(null);
    setStep(2);
  }

  function goToPaymentStep() {
    if (!pick) {
      toast.error("Elegí un horario para continuar.");
      return;
    }
    setStep(3);
  }

  async function submit() {
    const contact = contactSchema.safeParse({
      customer_name: form.customer_name,
      customer_phone: form.customer_phone,
      customer_email: form.customer_email,
    });
    const errs: Record<string, string> = {};
    if (!contact.success) {
      contact.error.issues.forEach((i) => {
        if (i.path[0]) errs[i.path[0] as string] = i.message;
      });
    }
    if (!form.service_id) errs.service_id = "Elegí un servicio";
    if (!form.vehicle_code) errs.vehicle_code = "Elegí el tamaño de tu vehículo";
    if (!pick) errs.slot = "Elegí un horario";
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }
    if (coverage.kind !== "ok" || !place) {
      toast.error("Dirección fuera de cobertura.");
      return;
    }

    const vehicle_type = VEHICLE_CODE_TO_TYPE[form.vehicle_code];
    if (!vehicle_type) {
      toast.error("Tipo de vehículo inválido.");
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
      address: place.formatted_address,
      formatted_address: place.formatted_address,
      place_id: place.place_id,
      address_lat: place.lat,
      address_lng: place.lng,
      neighborhood: coverage.zone_name,
      coverage_zone_id: coverage.zone_id,
      coverage_zone_name: coverage.zone_name,
      vehicle_type,
      service_id: form.service_id,
      scheduled_date: pick!.date,
      scheduled_time: pick!.time,
      payment_method: form.payment_method,
      notes: noteParts.join(" · ") || null,
      selected_extras: form.extras,
      marketing_source: attribution?.marketing_source ?? null,
      marketing_medium: attribution?.marketing_medium ?? null,
      marketing_campaign: attribution?.marketing_campaign ?? null,
      marketing_content: attribution?.marketing_content ?? null,
      marketing_term: attribution?.marketing_term ?? null,
      qr_code_slug: attribution?.qr_code_slug ?? null,
      landing_url: attribution?.landing_url ?? null,
      referrer_url: attribution?.referrer_url ?? null,
    };

    const { data, error } = await supabase.functions.invoke("create-website-booking", { body: payload });
    type Resp = {
      ok: boolean;
      status?: string;
      customer_message?: string;
      checkout_url?: string | null;
      summary?: Record<string, unknown>;
      booking_status?: string;
    };
    const res = (data ?? null) as Resp | null;

    if (error || !res?.ok) {
      setSubmitting(false);
      const status = res?.status ?? "";
      const friendly =
        status === "outside_coverage"
          ? "Esa dirección está fuera de nuestra cobertura actual."
          : status === "slot_too_soon"
            ? "Ese horario ya no está disponible. Elegí un horario más adelante."
          : status === "missing_duration" || status === "duration_config_error"
            ? "No pudimos calcular la duración del servicio. Probá nuevamente."
          : status === "slot_full" ||
              status === "slot_not_found" ||
              status === "service_does_not_fit_slot"
            ? "Ese horario ya no está disponible. Elegí otro."
            : status === "invalid_extra"
              ? "Hay un extra inválido. Actualizá la página."
              : (res?.customer_message ??
                "No pudimos crear la reserva. Probá nuevamente o escribinos por WhatsApp.");
      console.error("[Reservar][create-website-booking]", {
        error: error ? { message: error.message, name: error.name } : null,
        status,
        response: res,
      });
      toast.error(friendly, {
        action: { label: "WhatsApp", onClick: () => window.open(WHATSAPP_URL, "_blank") },
      });
      return;
    }

    try {
      sessionStorage.setItem(
        "washero:last-booking",
        JSON.stringify({ ...(res.summary ?? {}), payment_method: payload.payment_method }),
      );
    } catch {
      /* ignore */
    }

    if (res.checkout_url) {
      window.location.assign(res.checkout_url);
      return;
    }
    navigate({ to: "/gracias" });
  }

  return (
    <div className="mx-auto max-w-xl px-4 py-8 sm:py-12 pb-28">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Reservá tu lavado</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Dirección y servicio primero; después te mostramos horarios logísticos para tu zona.
        </p>
        <div className="mt-4 flex gap-1">
          {STEPS.map((label, i) => (
            <div
              key={label}
              className={cn(
                "h-1 flex-1 rounded-full",
                i <= step ? "bg-primary" : "bg-muted",
              )}
              title={label}
            />
          ))}
        </div>
        <p className="mt-2 text-xs font-medium text-muted-foreground">
          Paso {step + 1} de {STEPS.length}: {STEPS[step]}
        </p>
      </header>

      {step === 0 && (
        <section className="space-y-4 rounded-2xl border bg-card p-4 shadow-sm">
          <div>
            <h2 className="text-lg font-semibold">¿Dónde lavamos tu auto?</h2>
            <p className="text-sm text-muted-foreground">
              Buscá y seleccioná tu dirección en Google Maps.
            </p>
          </div>
          <PlacesAutocomplete
            value={form.address}
            onChange={(v) => update("address", v)}
            onSelect={(p) => {
              setPlace(p);
              if (p) update("address", p.formatted_address);
            }}
            placeholder="Ej: Av. del Libertador 1234, Tigre"
          />
          {!place && form.address.trim().length > 0 && (
            <p className="text-xs text-muted-foreground">
              Seleccioná una sugerencia de la lista para validar la zona.
            </p>
          )}
          {place && (
            <div className="space-y-2">
              {coverage.kind === "validating" && (
                <div className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" /> Validando cobertura…
                </div>
              )}
              {coverage.kind === "ok" && (
                <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Zona: {coverage.zone_name}
                </div>
              )}
              {coverage.kind === "outside" && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive space-y-2">
                  <div className="flex items-start gap-2">
                    <ShieldAlert className="h-4 w-4 mt-0.5 shrink-0" />
                    <span>{COVERAGE_COPY}</span>
                  </div>
                  <a
                    href={WHATSAPP_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 underline"
                  >
                    <MessageCircle className="h-3.5 w-3.5" /> Consultanos por WhatsApp
                  </a>
                </div>
              )}
              {coverage.kind === "error" && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
                  {coverage.message}
                </div>
              )}
            </div>
          )}
          <Button className="w-full" size="lg" disabled={coverage.kind !== "ok"} onClick={goToServiceStep}>
            Elegir servicio <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </section>
      )}

      {step === 1 && place && coverage.kind === "ok" && (
        <section className="space-y-5">
          <div className="rounded-xl border bg-muted/30 p-3 text-sm">
            <p className="flex items-start gap-2 font-medium">
              <MapPin className="h-4 w-4 shrink-0 text-primary" />
              {place.formatted_address}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">Zona {coverage.zone_name}</p>
          </div>

          <FormSection title="Servicio">
            {services.isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <div className="space-y-2">
                {(services.data ?? []).map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => update("service_id", s.id)}
                    className={cn(
                      "w-full rounded-xl border p-3 text-left",
                      form.service_id === s.id ? "border-primary border-2 bg-primary/5" : "border-border",
                    )}
                  >
                    <div className="flex justify-between gap-2">
                      <span className="font-semibold">{s.name}</span>
                      <span className="text-sm">{formatARS(s.base_price)}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">{s.duration_minutes} min</p>
                  </button>
                ))}
              </div>
            )}
            {errors.service_id && <p className="text-xs text-destructive">{errors.service_id}</p>}
          </FormSection>

          <FormSection title="Tamaño del vehículo">
            <div className="grid gap-2 sm:grid-cols-3">
              {vehicles.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => update("vehicle_code", v.code)}
                  className={cn(
                    "rounded-xl border p-3 text-left text-sm",
                    form.vehicle_code === v.code ? "border-primary border-2 bg-primary/5" : "",
                  )}
                >
                  <div className="font-medium">{v.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {v.amount > 0 ? `+ ${formatARS(v.amount)}` : "Sin cargo"} · +{v.duration_minutes} min
                  </div>
                </button>
              ))}
            </div>
            {errors.vehicle_code && <p className="text-xs text-destructive">{errors.vehicle_code}</p>}
          </FormSection>

          <FormSection title="Extras opcionales">
            <div className="space-y-2">
              {extras.map((e) => (
                <label
                  key={e.id}
                  className={cn(
                    "flex items-center justify-between rounded-xl border p-3 cursor-pointer",
                    form.extras.includes(e.code) && "border-primary bg-primary/5",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={form.extras.includes(e.code)}
                      onCheckedChange={() => toggleExtra(e.code)}
                    />
                    <span className="text-sm">{e.name}</span>
                  </div>
                  <span className="text-right text-xs font-semibold">
                    <span className="block text-sm">{formatARS(e.amount)}</span>
                    <span className="text-muted-foreground">+{e.duration_minutes} min</span>
                  </span>
                </label>
              ))}
            </div>
          </FormSection>

          <div className="rounded-xl border bg-muted/30 p-3 text-sm space-y-1">
            <div className="flex justify-between font-semibold">
              <span>Total estimado</span>
              <span>{formatARS(total)}</span>
            </div>
            {selectedService && (
              <p className="text-[10px] text-muted-foreground">
                Duración estimada: {estimatedDurationMinutes} min.
              </p>
            )}
          </div>

          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setStep(0)}>
              <ArrowLeft className="mr-1 h-4 w-4" /> Dirección
            </Button>
            <Button
              className="flex-1"
              disabled={!form.service_id || !form.vehicle_code}
              onClick={goToSlotsStep}
            >
              Ver horarios <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </section>
      )}

      {step === 2 && place && coverage.kind === "ok" && form.service_id && (
        <section className="space-y-5">
          <div className="rounded-xl border bg-muted/30 p-3 text-sm space-y-2">
            <p className="flex items-start gap-2 font-medium">
              <MapPin className="h-4 w-4 shrink-0 text-primary" />
              {place.formatted_address}
            </p>
            <p className="text-xs text-muted-foreground">
              {selectedService?.name} · {estimatedDurationMinutes} min · Zona {coverage.zone_name}
            </p>
            <button
              type="button"
              className="text-xs font-medium text-primary underline underline-offset-2"
              onClick={() => setStep(0)}
            >
              Cambiar dirección
            </button>
          </div>

          {logistic.isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : logistic.isError ? (
            <div className="rounded-lg border border-destructive/30 p-3 text-sm text-destructive">
              No pudimos cargar horarios.{" "}
              <button type="button" className="underline" onClick={() => logistic.refetch()}>
                Reintentar
              </button>
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <h2 className="text-base font-semibold">Elegí el día</h2>
                {daySummaries.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No encontramos horarios disponibles en los próximos días.{" "}
                    <a href={WHATSAPP_URL} target="_blank" rel="noreferrer" className="underline">
                      Escribinos por WhatsApp
                    </a>
                    .
                  </p>
                ) : (
                  <div className="-mx-1 flex snap-x snap-mandatory gap-2 overflow-x-auto px-1 pb-1">
                    {daySummaries.map((day) => (
                      <button
                        key={day.date}
                        type="button"
                        onClick={() => setFocusDate(day.date)}
                        className={cn(
                          "min-w-[150px] snap-start rounded-xl border p-3 text-left transition-colors",
                          focusDate === day.date
                            ? "border-primary bg-primary/10 ring-1 ring-primary/40"
                            : "border-border bg-card",
                        )}
                      >
                        <p className="text-sm font-semibold">{formatDayShort(day.date)}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {day.totalSlots} {day.totalSlots === 1 ? "horario" : "horarios"}
                        </p>
                        {day.hasRecommended && (
                          <span className="mt-2 inline-flex rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-medium text-primary">
                            Recomendado
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {daySummaries.length > 0 && (
                <div className="space-y-4">
                  <div className="space-y-1">
                    <h2 className="text-base font-semibold">Elegí un horario</h2>
                    <p className="text-sm text-muted-foreground capitalize">
                      {focusDay ? formatDayLong(focusDay.date) : ""}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Te sugerimos horarios que ayudan a ordenar la ruta de la camioneta por zona.
                    </p>
                  </div>

                  {focusDay ? (
                    <>
                      {recommendedForFocus.length > 0 ? (
                        <div className="space-y-2">
                          <h3 className="flex items-center gap-2 text-sm font-semibold">
                            <Sparkles className="h-4 w-4 text-primary" />
                            Horarios recomendados para tu zona
                          </h3>
                          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                            {recommendedForFocus.map((s) => (
                              <SlotCard
                                key={`${s.slot_id}-${s.date}-recommended`}
                                slot={s}
                                selected={pick?.slot_id === s.slot_id}
                                onSelect={() => selectSlot(s)}
                                recommended={s.score >= RECOMMENDED_SCORE_MIN}
                              />
                            ))}
                          </div>
                        </div>
                      ) : otherForFocus.length > 0 ? (
                        <div className="space-y-2">
                          <h3 className="text-sm font-semibold">Horarios disponibles para tu zona</h3>
                          <p className="text-xs text-muted-foreground">
                            Estos son los horarios disponibles para la dirección seleccionada.
                          </p>
                          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                            {otherForFocus.map((s) => (
                              <SlotCard
                                key={`${s.slot_id}-${s.date}-available`}
                                slot={s}
                                selected={pick?.slot_id === s.slot_id}
                                onSelect={() => selectSlot(s)}
                                recommended={false}
                              />
                            ))}
                          </div>
                        </div>
                      ) : null}

                      {recommendedForFocus.length > 0 && otherForFocus.length > 0 && (
                        <div className="space-y-2">
                          <button
                            type="button"
                            onClick={() => setShowOtherSlots((v) => !v)}
                            className="flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm font-semibold"
                          >
                            Otros horarios disponibles
                            {showOtherSlots ? (
                              <ChevronUp className="h-4 w-4 text-muted-foreground" />
                            ) : (
                              <ChevronDown className="h-4 w-4 text-muted-foreground" />
                            )}
                          </button>
                          {showOtherSlots && (
                            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                              {otherForFocus.map((s) => (
                                <SlotCard
                                  key={`${s.slot_id}-${s.date}-other`}
                                  slot={s}
                                  selected={pick?.slot_id === s.slot_id}
                                  onSelect={() => selectSlot(s)}
                                  recommended={false}
                                />
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {recommendedForFocus.length === 0 && otherForFocus.length === 0 && (
                        <p className="text-sm text-muted-foreground">
                          No hay horarios disponibles para este día. Probá con otra fecha.
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      No hay horarios disponibles para este día. Probá con otra fecha.
                    </p>
                  )}
                </div>
              )}
            </>
          )}

          <div className="sticky bottom-0 z-10 -mx-4 border-t bg-background/95 px-4 py-3 backdrop-blur">
            <div className="flex gap-2">
            <Button variant="outline" onClick={() => setStep(1)}>
              <ArrowLeft className="mr-1 h-4 w-4" /> Servicio
            </Button>
            <Button className="flex-1" disabled={!pick} onClick={goToPaymentStep}>
              Continuar <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
            </div>
          </div>
        </section>
      )}

      {step === 3 && pick && (
        <section className="space-y-5">
          <div className="rounded-xl border bg-muted/30 p-3 text-sm space-y-1">
            <p className="font-medium capitalize">{formatDayLong(pick.date)} · {pick.time} hs</p>
            <p className="text-muted-foreground">{selectedService?.name} · {formatARS(total)}</p>
            <p className="text-muted-foreground">Duración estimada: {estimatedDurationMinutes} min</p>
          </div>

          <FormSection title="Datos de contacto">
            <div className="space-y-3">
              <div>
                <Label>Nombre completo</Label>
                <Input
                  value={form.customer_name}
                  onChange={(e) => update("customer_name", e.target.value)}
                />
                {errors.customer_name && (
                  <p className="text-xs text-destructive">{errors.customer_name}</p>
                )}
              </div>
              <div>
                <Label>Teléfono</Label>
                <Input
                  inputMode="tel"
                  value={form.customer_phone}
                  onChange={(e) => update("customer_phone", e.target.value)}
                />
                {errors.customer_phone && (
                  <p className="text-xs text-destructive">{errors.customer_phone}</p>
                )}
              </div>
              <div>
                <Label>Email (opcional)</Label>
                <Input
                  type="email"
                  value={form.customer_email}
                  onChange={(e) => update("customer_email", e.target.value)}
                />
              </div>
            </div>
          </FormSection>

          <FormSection title="Notas">
            <Textarea
              rows={3}
              value={form.notes}
              onChange={(e) => update("notes", e.target.value)}
              placeholder="Acceso, color del auto…"
            />
            <label className="mt-2 flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox
                checked={form.whatsapp_reminders}
                onCheckedChange={(v) => update("whatsapp_reminders", !!v)}
              />
              Recibir recordatorios por WhatsApp
            </label>
          </FormSection>

          <label
            className={cn(
              "flex gap-3 rounded-xl border p-3 cursor-pointer",
              form.kipper_quote && "border-primary bg-primary/5",
            )}
          >
            <Checkbox
              checked={form.kipper_quote}
              onCheckedChange={(v) => update("kipper_quote", !!v)}
              className="mt-0.5"
            />
            <span className="text-sm">
              Quiero cotización de seguro con Kipper Seguros y beneficios en Washero.
            </span>
          </label>

          <FormSection title="Método de pago">
            <div className="grid gap-2">
              {PAYMENTS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => update("payment_method", p.value)}
                  className={cn(
                    "rounded-xl border p-3 text-left",
                    form.payment_method === p.value && "border-primary border-2 bg-primary/5",
                  )}
                >
                  <div className="font-medium text-sm">{p.label}</div>
                  <div className="text-xs text-muted-foreground">{p.hint}</div>
                </button>
              ))}
            </div>
          </FormSection>

          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setStep(2)}>
              <ArrowLeft className="mr-1 h-4 w-4" /> Horario
            </Button>
            <Button className="flex-1" size="lg" disabled={submitting} onClick={submit}>
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Enviando…
                </>
              ) : form.payment_method === "MercadoPago" ? (
                "Pagar con Mercado Pago →"
              ) : (
                "Confirmar reserva →"
              )}
            </Button>
          </div>
        </section>
      )}

      <p className="mt-8 text-center text-xs text-muted-foreground">
        <a href={WHATSAPP_URL} target="_blank" rel="noreferrer" className="underline inline-flex gap-1">
          <MessageCircle className="h-3 w-3" /> Ayuda por WhatsApp
        </a>
      </p>
    </div>
  );
}

function SlotCard({
  slot,
  selected,
  onSelect,
  recommended,
}: {
  slot: LogisticSlot;
  selected: boolean;
  onSelect: () => void;
  recommended?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "w-full rounded-xl border p-2.5 text-left transition-colors",
        selected ? "border-primary border-2 bg-primary/10" : "border-border hover:bg-muted/40",
        recommended && !selected && "border-primary/40",
      )}
    >
      <div className="space-y-1">
        <p className="text-base font-semibold leading-none">{slot.start_time}</p>
        {recommended && (
          <span className="inline-flex rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">
            Recomendado
          </span>
        )}
        <p className="truncate text-[10px] text-muted-foreground">{slot.reason}</p>
      </div>
    </button>
  );
}

function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-sm font-semibold mb-2">{title}</h3>
      {children}
    </div>
  );
}
