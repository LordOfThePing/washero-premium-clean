import { useMutation } from "@tanstack/react-query";
import { Loader2, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  invokeOperatorSendWhatsapp,
  type OperatorWhatsappAction,
} from "@/lib/operator";

const ACTIONS: Array<{ key: OperatorWhatsappAction; label: string }> = [
  { key: "operator_on_the_way", label: "Estoy en camino" },
  { key: "operator_arrived", label: "Llegué" },
  { key: "operator_delayed", label: "Estoy demorado" },
  { key: "operator_access_needed", label: "Necesito acceso" },
  { key: "operator_wash_completed", label: "Lavado finalizado" },
  { key: "operator_payment_reminder", label: "Recordar pago pendiente" },
];

function actionErrorMessage(status?: string) {
  if (status === "booking_forbidden") {
    return "No podés enviar mensajes para esta reserva.";
  }
  return "No pudimos enviar el WhatsApp. Revisá notificaciones/admin.";
}

type Props = {
  bookingId: string;
  compact?: boolean;
  onSent?: () => void;
};

export function OperatorWhatsappActions({ bookingId, compact, onSent }: Props) {
  const send = useMutation({
    mutationFn: async (actionKey: OperatorWhatsappAction) => {
      const res = await invokeOperatorSendWhatsapp({ booking_id: bookingId, action_key: actionKey });
      if (!res.ok) {
        throw new Error(actionErrorMessage(res.status));
      }
      return res;
    },
    onSuccess: () => {
      toast.success("Mensaje enviado por WhatsApp.");
      onSent?.();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const grid = (
    <div className={compact ? "grid grid-cols-2 gap-2" : "grid gap-2 sm:grid-cols-2"}>
      {ACTIONS.map((a) => (
        <Button
          key={a.key}
          type="button"
          variant="outline"
          className={compact ? "h-9 text-xs" : "h-11 justify-start"}
          disabled={send.isPending}
          onClick={() => send.mutate(a.key)}
        >
          {send.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 shrink-0 animate-spin" />
          ) : (
            <MessageCircle className="mr-2 h-4 w-4 shrink-0" />
          )}
          {a.label}
        </Button>
      ))}
    </div>
  );

  if (compact) return grid;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">WhatsApp al cliente</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-xs text-muted-foreground">
          Mensajes preaprobados vía Botmaker. No se envía texto libre desde la app.
        </p>
        {grid}
      </CardContent>
    </Card>
  );
}
