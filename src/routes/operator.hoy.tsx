import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { OperatorBookingCard } from "@/components/operator/OperatorBookingCard";
import { OPERATOR_BOOKING_SELECT, todayIso, type OperatorBooking } from "@/lib/operator";
import { useOperatorAuth } from "@/hooks/use-operator-auth";

export const Route = createFileRoute("/operator/hoy")({
  component: OperatorHoyPage,
});

function OperatorHoyPage() {
  const auth = useOperatorAuth();
  const myStaffId = auth.status === "operator" ? auth.profile.staff_id : null;
  const isStrictOperator = auth.status === "operator" && auth.profile.role === "operator";
  const today = todayIso();

  const bookings = useQuery({
    queryKey: ["operator", "bookings", today, myStaffId, isStrictOperator],
    enabled: auth.status === "operator",
    queryFn: async () => {
      let q = supabase
        .from("bookings")
        .select(OPERATOR_BOOKING_SELECT)
        .eq("scheduled_date", today)
        .neq("booking_status", "cancelled")
        .order("scheduled_time", { ascending: true });
      if (isStrictOperator && myStaffId) {
        q = q.eq("assigned_operator_id", myStaffId);
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as OperatorBooking[];
    },
  });

  const list = bookings.data ?? [];
  const next = list.find((b) => !["completed", "cancelled"].includes(b.booking_status));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Reservas de hoy</h1>
        <p className="text-sm text-muted-foreground">
          {list.length} lavado{list.length === 1 ? "" : "s"} programado{list.length === 1 ? "" : "s"}
        </p>
      </div>

      {next ? (
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
          <p className="font-medium text-primary">Próximo lavado</p>
          <p className="text-muted-foreground">
            {next.scheduled_time.slice(0, 5)} — {next.customer_name}
          </p>
        </div>
      ) : null}

      {bookings.isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : list.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">No hay lavados para hoy.</p>
      ) : (
        <div className="space-y-3">
          {list.map((b) => (
            <OperatorBookingCard key={b.id} booking={b} />
          ))}
        </div>
      )}
    </div>
  );
}
