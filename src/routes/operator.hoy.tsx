import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { OperatorDaySections } from "@/components/operator/OperatorDaySections";
import { OperatorNextWashHero } from "@/components/operator/OperatorNextWashHero";
import {
  OPERATOR_BOOKING_SELECT,
  groupTodayBookings,
  todayIso,
  type OperatorBooking,
} from "@/lib/operator";
import { useOperatorAuth } from "@/hooks/use-operator-auth";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/operator/hoy")({
  component: OperatorHoyPage,
});

function SummaryCard({
  label,
  value,
  active,
}: {
  label: string;
  value: number;
  active?: boolean;
}) {
  return (
    <Card className={cn(active && value > 0 && "border-primary/30 bg-primary/5")}>
      <CardContent className="p-3 text-center">
        <p className="text-xl font-semibold tabular-nums">{value}</p>
        <p className="text-[10px] font-medium text-muted-foreground">{label}</p>
      </CardContent>
    </Card>
  );
}

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

  const grouped = useMemo(() => groupTodayBookings(list), [list]);

  const inProgressCount = list.filter((b) => b.booking_status === "in_progress").length;
  const upcomingCount = list.filter(
    (b) => b.booking_status === "pending" || b.booking_status === "confirmed",
  ).length;
  const completedCount = grouped.completed.length;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Jornada de hoy</h1>
        <p className="text-sm text-muted-foreground">
          {list.length} lavado{list.length === 1 ? "" : "s"} programado{list.length === 1 ? "" : "s"}
        </p>
      </div>

      {bookings.isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : list.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">No hay lavados para hoy.</p>
      ) : (
        <>
          <div className="grid grid-cols-4 gap-2">
            <SummaryCard label="Total" value={list.length} />
            <SummaryCard label="En curso" value={inProgressCount} active />
            <SummaryCard label="Próximos" value={upcomingCount} />
            <SummaryCard label="Terminados" value={completedCount} />
          </div>

          {grouped.next ? (
            <OperatorNextWashHero booking={grouped.next} />
          ) : completedCount > 0 ? (
            <Card className="border-green-300/40 bg-green-50/50 dark:bg-green-950/20">
              <CardContent className="flex items-center gap-3 p-4">
                <CheckCircle2 className="h-8 w-8 shrink-0 text-green-600 dark:text-green-400" />
                <div>
                  <p className="font-medium text-green-900 dark:text-green-100">Jornada completa</p>
                  <p className="text-sm text-muted-foreground">
                    Terminaste {completedCount} lavado{completedCount === 1 ? "" : "s"} hoy.
                  </p>
                </div>
              </CardContent>
            </Card>
          ) : null}

          <OperatorDaySections
            inProgress={grouped.inProgress}
            needsReview={grouped.needsReview}
            upcoming={grouped.upcoming}
            completed={grouped.completed}
            detailFrom="hoy"
          />
        </>
      )}
    </div>
  );
}
