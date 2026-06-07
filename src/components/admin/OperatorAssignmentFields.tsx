import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, UserCog } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Booking } from "@/components/admin/bookings";
import { notifyOperatorAssignmentPush } from "@/lib/web-push";

type StaffRow = { id: string; email: string | null; role: string };

function toastAssignmentPushResult(result: { sent_count: number; skipped_reason?: string }) {
  if (result.sent_count > 0) {
    toast.success("Operador asignado y notificado.");
    return;
  }
  if (result.skipped_reason === "no_subscriptions") {
    toast.warning("Operador asignado. No tiene notificaciones PWA activadas.");
    return;
  }
  toast.success("Operador asignado.");
}

export function OperatorAssignmentFields({ booking }: { booking: Booking }) {
  const qc = useQueryClient();
  const [operatorId, setOperatorId] = useState(booking.assigned_operator_id ?? "");
  const [vehicleLabel, setVehicleLabel] = useState(booking.assigned_vehicle_label ?? "");

  const staffQuery = useQuery({
    queryKey: ["admin", "operator-staff"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("admin_users")
        .select("id, email, role")
        .eq("active", true)
        .in("role", ["owner", "admin", "operator"])
        .order("email");
      if (error) throw error;
      return (data ?? []) as StaffRow[];
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      const previousOperatorId = booking.assigned_operator_id ?? null;
      const newOperatorId = operatorId || null;

      const { error } = await supabase
        .from("bookings")
        .update({
          assigned_operator_id: newOperatorId,
          assigned_vehicle_label: vehicleLabel.trim() || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", booking.id);
      if (error) throw error;

      return { previousOperatorId, newOperatorId };
    },
    onSuccess: async ({ previousOperatorId, newOperatorId }) => {
      qc.invalidateQueries({ queryKey: ["admin", "bookings"] });
      qc.invalidateQueries({ queryKey: ["admin", "calendar"] });
      booking.assigned_operator_id = newOperatorId;
      booking.assigned_vehicle_label = vehicleLabel.trim() || null;

      const operatorChanged = previousOperatorId !== newOperatorId;

      if (!operatorChanged) {
        toast.success("Asignación guardada.");
        return;
      }

      if (!newOperatorId) {
        toast.success("Asignación guardada.");
        return;
      }

      try {
        const result = await notifyOperatorAssignmentPush(booking.id);
        toastAssignmentPushResult(result);
      } catch {
        toast.warning("Operador asignado, pero no pudimos enviar la notificación.");
      }
    },
    onError: (e: Error) => toast.error(e.message || "No pudimos guardar la asignación."),
  });

  const notifyOperator = useMutation({
    mutationFn: async () => {
      if (!booking.assigned_operator_id && !operatorId) {
        throw new Error("no_operator");
      }
      return notifyOperatorAssignmentPush(booking.id);
    },
    onSuccess: (result) => {
      if (result.sent_count > 0) {
        toast.success("Notificación enviada al operador.");
      } else if (result.skipped_reason === "no_subscriptions") {
        toast.warning("El operador no tiene notificaciones PWA activadas.");
      } else {
        toast.message("No se envió la notificación (sin suscripción activa o operador inactivo).");
      }
    },
    onError: (e: Error) => {
      if (e.message === "no_operator") {
        toast.error("Asigná un operador antes de notificar.");
        return;
      }
      toast.error("No se pudo enviar la notificación.");
    },
  });

  const logsQuery = useQuery({
    queryKey: ["admin", "booking-operator-logs", booking.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("communication_logs")
        .select("id,created_at,provider,channel,direction,message_text")
        .eq("booking_id", booking.id)
        .order("created_at", { ascending: false })
        .limit(6);
      if (error) throw error;
      return data ?? [];
    },
  });

  const dirty =
    (operatorId || "") !== (booking.assigned_operator_id ?? "") ||
    vehicleLabel.trim() !== (booking.assigned_vehicle_label ?? "").trim();

  return (
    <div className="space-y-2 border-t pt-3">
      <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <UserCog className="h-3.5 w-3.5" />
        Operador
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs">Asignar a</Label>
          <Select
            value={operatorId || "__none__"}
            onValueChange={(v) => setOperatorId(v === "__none__" ? "" : v)}
            disabled={staffQuery.isLoading}
          >
            <SelectTrigger className="h-9 text-sm">
              <SelectValue placeholder="Sin asignar" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">Sin asignar (todos los operadores)</SelectItem>
              {(staffQuery.data ?? []).map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.email ?? s.id.slice(0, 8)} ({s.role})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Vehículo / móvil</Label>
          <Input
            className="h-9 text-sm"
            placeholder="Ej. Kangoo blanca"
            value={vehicleLabel}
            onChange={(e) => setVehicleLabel(e.target.value)}
          />
        </div>
      </div>
      {booking.operator_notes && (
        <p className="text-xs text-muted-foreground whitespace-pre-wrap">
          Notas operador: {booking.operator_notes}
        </p>
      )}
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={!dirty || save.isPending}
        onClick={() => save.mutate()}
      >
        {save.isPending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
        Guardar asignación
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={
          notifyOperator.isPending || dirty || (!operatorId && !booking.assigned_operator_id)
        }
        onClick={() => notifyOperator.mutate()}
      >
        {notifyOperator.isPending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
        Notificar operador
      </Button>
      <div className="rounded-md border bg-muted/30 p-2">
        <p className="mb-1 text-xs font-medium text-muted-foreground">Logs operativos</p>
        {logsQuery.isLoading ? (
          <p className="text-xs text-muted-foreground">Cargando...</p>
        ) : logsQuery.data && logsQuery.data.length > 0 ? (
          <div className="space-y-1">
            {logsQuery.data.map((log) => (
              <p key={log.id} className="text-xs text-muted-foreground">
                {new Date(log.created_at).toLocaleString("es-AR")} · {log.channel} · {log.message_text ?? "—"}
              </p>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Sin logs todavía.</p>
        )}
      </div>
    </div>
  );
}
