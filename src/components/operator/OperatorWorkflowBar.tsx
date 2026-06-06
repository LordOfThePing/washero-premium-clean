import type { CSSProperties } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  OPERATOR_LAYOUT,
  canOperatorStartBooking,
  getIssueActionLabel,
  getPrimaryBookingAction,
  getWorkflowPhase,
  type OperatorBooking,
} from "@/lib/operator";

type Props = {
  booking: OperatorBooking;
  isUpdating?: boolean;
  onStart?: () => void;
  onComplete?: () => void;
  onMarkPaid?: () => void;
  onReportIssue?: () => void;
};

export function OperatorWorkflowBar({
  booking,
  isUpdating = false,
  onStart,
  onComplete,
  onMarkPaid,
  onReportIssue,
}: Props) {
  const phase = getWorkflowPhase(booking);
  const primary = getPrimaryBookingAction(booking);
  const isNeedsReview = booking.booking_status === "needs_review";
  const showStartSecondary =
    isNeedsReview && canOperatorStartBooking(booking) && !!onStart;
  const showReportSecondary =
    !isNeedsReview &&
    booking.booking_status !== "completed" &&
    booking.booking_status !== "cancelled";

  const handlePrimary = () => {
    if (isUpdating) return;
    if (primary.type === "start") onStart?.();
    else if (primary.type === "complete") onComplete?.();
    else if (primary.type === "mark_paid") onMarkPaid?.();
    else if (phase === "issue") onReportIssue?.();
  };

  const showPrimaryButton =
    phase !== "cancelled" &&
    phase !== "done" &&
    (primary.type === "start" ||
      primary.type === "complete" ||
      primary.type === "mark_paid" ||
      phase === "issue");

  const primaryLabel =
    phase === "issue" ? getIssueActionLabel(booking) : primary.label;

  const statusMessage =
    phase === "done"
      ? "Lavado finalizado"
      : phase === "cancelled"
        ? "Reserva cancelada"
        : null;

  const workflowBarHeight =
    showPrimaryButton && (showStartSecondary || showReportSecondary)
      ? "7.5rem"
      : showPrimaryButton || showStartSecondary || showReportSecondary
        ? "5.5rem"
        : "3rem";

  return (
    <div
      className={cn(
        "fixed left-0 right-0 z-40 border-t border-border/60 bg-background/95 px-4 py-3 backdrop-blur",
        OPERATOR_LAYOUT.workflowBarBottom,
      )}
      style={
        {
          [OPERATOR_LAYOUT.workflowBarHeightVar]: workflowBarHeight,
          paddingBottom: "max(0.75rem, env(safe-area-inset-bottom, 0px))",
        } as CSSProperties
      }
    >
      <div className="mx-auto flex max-w-lg flex-col gap-2">
        {statusMessage ? (
          <p className="text-center text-sm font-medium text-muted-foreground">{statusMessage}</p>
        ) : null}

        {showPrimaryButton ? (
          <Button
            type="button"
            className="h-12 w-full text-base"
            disabled={isUpdating}
            onClick={handlePrimary}
          >
            {isUpdating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {primaryLabel}
          </Button>
        ) : null}

        {showStartSecondary ? (
          <Button
            type="button"
            variant="outline"
            className="h-10 w-full"
            disabled={isUpdating}
            onClick={onStart}
          >
            Iniciar lavado
          </Button>
        ) : null}

        {showReportSecondary ? (
          <Button
            type="button"
            variant="outline"
            className="h-10 w-full"
            disabled={isUpdating}
            onClick={onReportIssue}
          >
            Reportar problema
          </Button>
        ) : null}
      </div>
    </div>
  );
}
