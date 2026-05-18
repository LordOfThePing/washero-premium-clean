import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2, MapPin, MessageCircle, Navigation } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
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
import { OperatorStatusTimeline } from "@/components/operator/OperatorBookingCard";
import {
  OPERATOR_BOOKING_SELECT,
  formatOpDate,
  formatOpTime,
  invokeOperatorUpdateBooking,
  mapsUrl,
  paymentInstruction,
  wazeUrl,
  whatsappClientUrl,
  type OperatorBooking,
} from "@/lib/operator";
import { BookingStatusBadge, PaymentStatusBadge } from "@/lib/booking-badges";

export const Route = createFileRoute("/operator/reserva/$bookingId")({
  component: OperatorReservaDetailPage,
});

function OperatorReservaDetailPage() {
  const { bookingId } = Route.useParams();
  const qc = useQueryClient();
  const [issueOpen, setIssueOpen] = useState(false);
  const [issueNote, setIssueNote] = useState("");
  const [payDialog, setPayDialog] = useState(false);

  const booking = useQuery({
    queryKey: ["operator", "booking", bookingId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bookings")
        .select(OPERATOR_BOOKING_SELECT)
        .eq("id", bookingId)
        .maybeSingle();
      if (error) throw error;
      return data as OperatorBooking | null;
    },
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["operator"] });
  };

  const runAction = useMutation({
    mutationFn: invokeOperatorUpdateBooking,
    onSuccess: (res, vars) => {
      if (!res.ok) throw new Error(res.message ?? "No se pudo actualizar.");
      if (vars.action === "start") toast.success("Lavado iniciado.");
      if (vars.action === "complete") toast.success("Lavado completado.");
      if (vars.action === "mark_paid") toast.success("Pago registrado.");
      if (vars.action === "report_issue") toast.success("Problema reportado.");
      if (res.invoice_created) toast.message("Factura generada.");
      invalidate();
      booking.refetch();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const b = booking.data;
  if (booking.isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }
  if (!b) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">Reserva no encontrada.</p>
    );
  }

  const pay = paymentInstruction(b);
  const addr = b.formatted_address || b.address;
  const extras = Array.isArray(b.selected_extras) ? (b.selected_extras as string[]).join(", ") : "";
  const canStart = ["pending", "confirmed", "needs_review"].includes(b.booking_status);
  const canComplete = ["confirmed", "in_progress", "needs_review", "pending"].includes(
    b.booking_status,
  );
  const collectOnComplete =
    b.payment_method === "Pagar después" && b.payment_status !== "paid";

  const completeWash = (markPaid: boolean) => {
    runAction.mutate({
      booking_id: b.id,
      action: "complete",
      mark_paid: markPaid,
    });
    setPayDialog(false);
  };

  return (
    <div className="space-y-4 pb-8">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link to="/operator/hoy">
          <ArrowLeft className="mr-1 h-4 w-4" /> Volver
        </Link>
      </Button>

      <div>
        <h1 className="text-xl font-semibold">{b.customer_name}</h1>
        <p className="text-sm text-muted-foreground">
          {formatOpDate(b.scheduled_date)} · {formatOpTime(b.scheduled_time)}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <BookingStatusBadge value={b.booking_status} />
          <PaymentStatusBadge value={b.payment_status} />
        </div>
      </div>

      <OperatorStatusTimeline status={b.booking_status} />

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Servicio</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            {b.service_name} · {b.vehicle_type}
          </p>
          {extras ? <p className="text-muted-foreground">Extras: {extras}</p> : null}
          <p className="font-medium text-primary">{pay.label}</p>
          <p className="text-muted-foreground">{b.payment_method}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Ubicación</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="flex gap-2">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
            {addr}
            {b.neighborhood ? `, ${b.neighborhood}` : ""}
          </p>
          <div className="grid gap-2">
            <Button asChild variant="outline" className="h-11">
              <a href={whatsappClientUrl(b.customer_phone)} target="_blank" rel="noreferrer">
                <MessageCircle className="mr-2 h-4 w-4" /> Escribir al cliente
              </a>
            </Button>
            <Button asChild variant="secondary" className="h-11">
              <a href={mapsUrl(b)} target="_blank" rel="noreferrer">
                <Navigation className="mr-2 h-4 w-4" /> Abrir Google Maps
              </a>
            </Button>
            <Button asChild variant="outline" className="h-11">
              <a href={wazeUrl(b)} target="_blank" rel="noreferrer">
                Abrir Waze
              </a>
            </Button>
          </div>
        </CardContent>
      </Card>

      {(b.notes || b.operator_notes) && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Notas</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm whitespace-pre-wrap">
            {b.notes ? <p>{b.notes}</p> : null}
            {b.operator_notes ? (
              <p className="text-muted-foreground">{b.operator_notes}</p>
            ) : null}
          </CardContent>
        </Card>
      )}

      <div className="space-y-2">
        {canStart && (
          <Button
            className="h-12 w-full text-base"
            disabled={runAction.isPending}
            onClick={() => runAction.mutate({ booking_id: b.id, action: "start" })}
          >
            Iniciar lavado
          </Button>
        )}
        {canComplete && (
          <Button
            className="h-12 w-full text-base"
            variant="default"
            disabled={runAction.isPending}
            onClick={() => {
              if (collectOnComplete) setPayDialog(true);
              else completeWash(false);
            }}
          >
            Completar lavado
          </Button>
        )}
        {b.payment_status !== "paid" && b.booking_status === "completed" && (
          <Button
            className="h-12 w-full"
            variant="secondary"
            disabled={runAction.isPending}
            onClick={() =>
              runAction.mutate({ booking_id: b.id, action: "mark_paid" })
            }
          >
            Marcar cobrado
          </Button>
        )}
        <Button
          className="h-12 w-full"
          variant="outline"
          onClick={() => setIssueOpen(true)}
        >
          Reportar problema
        </Button>
      </div>

      <AlertDialog open={payDialog} onOpenChange={setPayDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Cobraste el pago?</AlertDialogTitle>
            <AlertDialogDescription>
              Este lavado es “Pagar después”. Indicá si cobraste al cliente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col gap-2 sm:flex-col">
            <AlertDialogAction
              className="w-full"
              onClick={() => completeWash(true)}
            >
              Sí, cobrado
            </AlertDialogAction>
            <AlertDialogCancel className="w-full" onClick={() => completeWash(false)}>
              No todavía
            </AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={issueOpen} onOpenChange={setIssueOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reportar problema</AlertDialogTitle>
            <AlertDialogDescription>
              Describí qué pasó. El equipo lo verá en revisión.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea
            value={issueNote}
            onChange={(e) => setIssueNote(e.target.value)}
            placeholder="Ej: cliente no estaba, dirección incorrecta…"
            rows={3}
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                runAction.mutate({
                  booking_id: b.id,
                  action: "report_issue",
                  issue_note: issueNote,
                });
                setIssueOpen(false);
                setIssueNote("");
              }}
            >
              Enviar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
