import { OperatorBookingCard } from "@/components/operator/OperatorBookingCard";
import type { OperatorBooking } from "@/lib/operator";

type SectionProps = {
  title: string;
  bookings: OperatorBooking[];
  variant?: "default" | "done";
  emptyMessage?: string;
  detailFrom?: string;
};

function OperatorBookingSection({
  title,
  bookings,
  variant = "default",
  emptyMessage,
  detailFrom,
}: SectionProps) {
  if (bookings.length === 0) {
    if (emptyMessage) {
      return (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground">{title}</h2>
          <p className="text-xs text-muted-foreground">{emptyMessage}</p>
        </section>
      );
    }
    return null;
  }

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold">
        {title}{" "}
        <span className="font-normal text-muted-foreground">({bookings.length})</span>
      </h2>
      <div className="space-y-3">
        {bookings.map((b) => (
          <OperatorBookingCard
            key={b.id}
            booking={b}
            variant={variant === "done" ? "done" : "default"}
            detailFrom={detailFrom}
          />
        ))}
      </div>
    </section>
  );
}

type Props = {
  inProgress: OperatorBooking[];
  needsReview: OperatorBooking[];
  upcoming: OperatorBooking[];
  completed: OperatorBooking[];
  detailFrom?: string;
};

export function OperatorDaySections({
  inProgress,
  needsReview,
  upcoming,
  completed,
  detailFrom,
}: Props) {
  const hasSections =
    inProgress.length > 0 ||
    needsReview.length > 0 ||
    upcoming.length > 0 ||
    completed.length > 0;

  if (!hasSections) return null;

  return (
    <div className="space-y-6">
      <OperatorBookingSection title="En curso" bookings={inProgress} detailFrom={detailFrom} />
      <OperatorBookingSection
        title="Requieren revisión"
        bookings={needsReview}
        detailFrom={detailFrom}
      />
      <OperatorBookingSection title="Próximos" bookings={upcoming} detailFrom={detailFrom} />
      <OperatorBookingSection
        title="Terminados hoy"
        bookings={completed}
        variant="done"
        detailFrom={detailFrom}
      />
    </div>
  );
}
