import { type FormEvent, useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { invokeCreateSubscriptionBooking } from "@/lib/admin-subscription-booking";
import { remainingWashes, formatSubDate } from "@/lib/subscriptions";
import { ADMIN_VEHICLE_TYPES } from "@/lib/admin-booking";
import { useLookups, useSlotsForDate, todayIso } from "@/components/admin/bookings";

export type ScheduleSubContext = {
  subscriptionId: string;
  customerName: string;
  planName: string;
  washesPerMonth: number;
  usedWashes: number;
  periodStart: string;
  periodEnd: string;
  allowedServiceIds: string[];
  defaultAddress: string;
  defaultNeighborhood: string;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  context: ScheduleSubContext | null;
  onSuccess: () => void;
};

export function ScheduleSubscriptionWashDialog({ open, onOpenChange, context, onSuccess }: Props) {
  const { services, areas } = useLookups();
  const [scheduledDate, setScheduledDate] = useState(todayIso());
  const [scheduledTime, setScheduledTime] = useState("10:00");
  const [serviceId, setServiceId] = useState("");
  const [vehicleType, setVehicleType] = useState("Auto");
  const [address, setAddress] = useState("");
  const [neighborhood, setNeighborhood] = useState("");
  const [notes, setNotes] = useState("");
  const slots = useSlotsForDate(scheduledDate);

  const availableServices = useMemo(() => {
    const all = services.data ?? [];
    if (!context?.allowedServiceIds?.length) return all;
    return all.filter((s) => context.allowedServiceIds.includes(s.id));
  }, [services.data, context?.allowedServiceIds]);

  useEffect(() => {
    if (!open || !context) return;
    setScheduledDate(todayIso());
    setScheduledTime("10:00");
    setAddress(context.defaultAddress);
    setNeighborhood(context.defaultNeighborhood);
    setNotes("");
    const first = availableServices[0]?.id ?? "";
    setServiceId(first);
    setVehicleType("Auto");
  }, [open, context, availableServices]);

  const remaining = context ? remainingWashes(context.washesPerMonth, context.usedWashes) : 0;

  const slotWarning = useMemo(() => {
    if (!slots.data) return null;
    const match = slots.data.find((s) => s.start_time.slice(0, 5) === scheduledTime.slice(0, 5));
    if (!match) return "Este horario puede no existir en disponibilidad.";
    if (!match.active) return "Este slot está inactivo.";
    return null;
  }, [slots.data, scheduledTime]);

  const create = useMutation({
    mutationFn: async () => {
      if (!context) throw new Error("Sin suscripción.");
      if (remaining <= 0) {
        throw new Error("No quedan lavados disponibles en este período.");
      }
      if (!serviceId) throw new Error("Elegí un servicio.");
      if (!address.trim() || !neighborhood.trim()) {
        throw new Error("Completá dirección y barrio.");
      }
      const time = scheduledTime.length === 5 ? `${scheduledTime}:00` : scheduledTime;
      const res = await invokeCreateSubscriptionBooking({
        customer_subscription_id: context.subscriptionId,
        service_id: serviceId,
        scheduled_date: scheduledDate,
        scheduled_time: time,
        address: address.trim(),
        neighborhood: neighborhood.trim(),
        vehicle_type: vehicleType,
        notes: notes.trim() || null,
      });
      if (!res.ok) {
        throw new Error(res.customer_message ?? "No pudimos agendar el lavado.");
      }
      return res;
    },
    onSuccess: () => {
      toast.success("Lavado de suscripción agendado.");
      onOpenChange(false);
      onSuccess();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };

  if (!context) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Agendar lavado — {context.customerName}</DialogTitle>
          <DialogDescription>
            {context.planName} · Período {formatSubDate(context.periodStart)} —{" "}
            {formatSubDate(context.periodEnd)} · Quedan {remaining} de {context.washesPerMonth}{" "}
            lavados
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Fecha</Label>
              <Input
                type="date"
                value={scheduledDate}
                onChange={(e) => setScheduledDate(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label>Horario</Label>
              <Select value={scheduledTime} onValueChange={setScheduledTime}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(slots.data ?? []).length > 0 ? (
                    slots.data!.map((s) => (
                      <SelectItem key={s.id} value={s.start_time.slice(0, 5)}>
                        {s.start_time.slice(0, 5)}
                      </SelectItem>
                    ))
                  ) : (
                    <SelectItem value={scheduledTime}>{scheduledTime}</SelectItem>
                  )}
                </SelectContent>
              </Select>
              {slotWarning ? (
                <p className="text-xs text-amber-600 dark:text-amber-400">{slotWarning}</p>
              ) : null}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Servicio</Label>
            <Select value={serviceId} onValueChange={setServiceId}>
              <SelectTrigger>
                <SelectValue placeholder="Elegir servicio" />
              </SelectTrigger>
              <SelectContent>
                {availableServices.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Vehículo</Label>
            <Select value={vehicleType} onValueChange={setVehicleType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ADMIN_VEHICLE_TYPES.map((v) => (
                  <SelectItem key={v} value={v}>
                    {v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Dirección</Label>
            <Input value={address} onChange={(e) => setAddress(e.target.value)} required />
          </div>

          <div className="space-y-2">
            <Label>Barrio / zona</Label>
            <Select value={neighborhood} onValueChange={setNeighborhood}>
              <SelectTrigger>
                <SelectValue placeholder="Barrio" />
              </SelectTrigger>
              <SelectContent>
                {neighborhood && !(areas.data ?? []).some((a) => a.name === neighborhood) ? (
                  <SelectItem value={neighborhood}>{neighborhood}</SelectItem>
                ) : null}
                {(areas.data ?? []).map((a) => (
                  <SelectItem key={a.id} value={a.name}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Notas (opcional)</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={create.isPending || remaining <= 0}>
              {create.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              Agendar lavado
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
