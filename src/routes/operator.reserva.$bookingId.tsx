import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, MessageCircle, RefreshCw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
import { OperatorAccessSummary } from "@/components/operator/OperatorAccessSummary";
import { OperatorBookingUnitsSummary } from "@/components/operator/OperatorBookingUnitsSummary";
import { OperatorDetailHeader } from "@/components/operator/OperatorDetailHeader";
import { OperatorPriceSummary } from "@/components/operator/OperatorPriceSummary";
import { OperatorWhatsappActions } from "@/components/operator/OperatorWhatsappActions";
import { OperatorWorkflowBar } from "@/components/operator/OperatorWorkflowBar";
import {
  OPERATOR_LAYOUT,
  canOperatorStartBooking,
  fetchOperatorBookingDetail,
  getIssueActionLabel,
  getPrimaryBookingAction,
  getWorkflowPhase,
  invokeOperatorUpdateBooking,
  whatsappClientUrl,
} from "@/lib/operator";
import { cn } from "@/lib/utils";

type ReservaSearch = {
  from?: string;
};

export const Route = createFileRoute("/operator/reserva/$bookingId")({
  validateSearch: (search: Record<string, unknown>): ReservaSearch => ({
    from: typeof search.from === "string" ? search.from : undefined,
  }),
  component: OperatorReservaDetailPage,
});

function OperatorReservaDetailPage() {
  const { bookingId } = Route.useParams();
  const { from } = Route.useSearch();
  const qc = useQueryClient();
  const [issueOpen, setIssueOpen] = useState(false);
  const [issueNote, setIssueNote] = useState("");
  const [payDialog, setPayDialog] = useState(false);

  const detail = useQuery({
    queryKey: ["operator", "booking-detail", bookingId],
    queryFn: async () => {
      const res = await fetchOperatorBookingDetail(bookingId);
      if (res.error) throw new Error(res.error);
      if (!res.booking) throw new Error("Reserva no encontrada.");
      return { booking: res.booking, units: res.units };
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
      detail.refetch();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (detail.isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (detail.isError || !detail.data) {
    const errMsg =
      detail.error instanceof Error
        ? detail.error.message
        : "No pudimos cargar el detalle de esta reserva.";

    return (
      <div className="space-y-4 py-12 text-center">
        <p className="text-sm text-muted-foreground">{errMsg}</p>
        <Button type="button" variant="outline" onClick={() => detail.refetch()}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Reintentar
        </Button>
      </div>
    );
  }

  const b = detail.data.booking;
  const units = detail.data.units;
  const phase = getWorkflowPhase(b);
  const primaryAction = getPrimaryBookingAction(b);
  const collectOnComplete = b.payment_method === "Pagar después" && b.payment_status !== "paid";
  const canStart = canOperatorStartBooking(b);
  const canComplete = b.booking_status === "in_progress";
  const issueDialogTitle = getIssueActionLabel(b);

  const completeWash = (markPaid: boolean) => {
    runAction.mutate({
      booking_id: b.id,
      action: "complete",
      mark_paid: markPaid,
    });
    setPayDialog(false);
  };

  const handleComplete = () => {
    if (!canComplete) return;
    if (collectOnComplete) setPayDialog(true);
    else completeWash(false);
  };

  return (
    <div className={cn("space-y-4", OPERATOR_LAYOUT.detailPagePadding)}>
      <OperatorDetailHeader booking={b} from={from} />

      <div className="space-y-2">
        <OperatorStatusTimeline status={b.booking_status} />
        <p className="text-sm text-muted-foreground">{primaryAction.helper}</p>
      </div>

      <OperatorAccessSummary booking={b} detailFrom={from} />

      <OperatorWhatsappActions booking={b} phase={phase} />

      <div className="text-center">
        <Button asChild variant="link" size="sm" className="h-auto p-0 text-xs text-muted-foreground">
          <a href={whatsappClientUrl(b.customer_phone)} target="_blank" rel="noreferrer">
            <MessageCircle className="mr-1 inline h-3.5 w-3.5" />
            Abrir WhatsApp manual — solo emergencia
          </a>
        </Button>
      </div>

      <OperatorBookingUnitsSummary booking={b} units={units} />
      <OperatorPriceSummary booking={b} units={units} />

      <OperatorWorkflowBar
        booking={b}
        isUpdating={runAction.isPending}
        onStart={
          canStart
            ? () => runAction.mutate({ booking_id: b.id, action: "start" })
            : undefined
        }
        onComplete={canComplete ? handleComplete : undefined}
        onMarkPaid={
          phase === "payment"
            ? () => runAction.mutate({ booking_id: b.id, action: "mark_paid" })
            : undefined
        }
        onReportIssue={() => setIssueOpen(true)}
      />

      <AlertDialog open={payDialog} onOpenChange={setPayDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Cobraste el pago?</AlertDialogTitle>
            <AlertDialogDescription>
              Este lavado es “Pagar después”. Indicá si cobraste al cliente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col gap-2 sm:flex-col">
            <AlertDialogAction className="w-full" onClick={() => completeWash(true)}>
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
            <AlertDialogTitle>{issueDialogTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {b.booking_status === "needs_review"
                ? "Contanos qué pasó o si ya pudiste resolverlo. El equipo lo verá en revisión."
                : "Describí qué pasó. El equipo lo verá en revisión."}
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
