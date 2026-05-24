import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { OperatorBookingCard } from "@/components/operator/OperatorBookingCard";
import { OPERATOR_BOOKING_SELECT, todayIso, type OperatorBooking } from "@/lib/operator";
import { useOperatorAuth } from "@/hooks/use-operator-auth";

export const Route = createFileRoute("/operator/pendientes")({
  component: OperatorPendientesPage,
});

function OperatorPendientesPage() {
  const auth = useOperatorAuth();
  const myStaffId = auth.status === "operator" ? auth.profile.staff_id : null;
  const isStrictOperator = auth.status === "operator" && auth.profile.role === "operator";
  const today = todayIso();

  const bookings = useQuery({
    queryKey: ["operator", "pendientes", today, myStaffId, isStrictOperator],
    enabled: auth.status === "operator",
    queryFn: async () => {
      let q = supabase
        .from("bookings")
        .select(OPERATOR_BOOKING_SELECT)
        .gte("scheduled_date", today)
        .in("booking_status", ["pending", "needs_review", "confirmed", "in_progress"])
        .order("scheduled_date", { ascending: true })
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

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Pendientes</h1>
        <p className="text-sm text-muted-foreground">
          Lavados activos o por confirmar desde hoy en adelante.
        </p>
      </div>

      {bookings.isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : list.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">No hay pendientes.</p>
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
