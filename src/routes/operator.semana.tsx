import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { OperatorBookingCard } from "@/components/operator/OperatorBookingCard";
import {
  OPERATOR_BOOKING_SELECT,
  addDaysIso,
  formatOpDate,
  todayIso,
  type OperatorBooking,
} from "@/lib/operator";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/operator/semana")({
  component: OperatorSemanaPage,
});

type Filter = "all" | "pending" | "confirmed" | "in_progress" | "completed";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "Todos" },
  { value: "pending", label: "Pendientes" },
  { value: "confirmed", label: "Confirmadas" },
  { value: "in_progress", label: "En proceso" },
  { value: "completed", label: "Completados" },
];

function OperatorSemanaPage() {
  const [filter, setFilter] = useState<Filter>("all");
  const from = todayIso();
  const to = addDaysIso(6);

  const bookings = useQuery({
    queryKey: ["operator", "bookings", "week", from, to],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bookings")
        .select(OPERATOR_BOOKING_SELECT)
        .gte("scheduled_date", from)
        .lte("scheduled_date", to)
        .neq("booking_status", "cancelled")
        .order("scheduled_date", { ascending: true })
        .order("scheduled_time", { ascending: true });
      if (error) throw error;
      return (data ?? []) as OperatorBooking[];
    },
  });

  const filtered = useMemo(() => {
    const list = bookings.data ?? [];
    if (filter === "all") return list;
    if (filter === "pending") {
      return list.filter((b) => b.booking_status === "pending" || b.booking_status === "needs_review");
    }
    return list.filter((b) => b.booking_status === filter);
  }, [bookings.data, filter]);

  const byDay = useMemo(() => {
    const map = new Map<string, OperatorBooking[]>();
    for (const b of filtered) {
      const arr = map.get(b.scheduled_date) ?? [];
      arr.push(b);
      map.set(b.scheduled_date, arr);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Próximos 7 días</h1>
        <p className="text-sm text-muted-foreground">
          {formatOpDate(from)} — {formatOpDate(to)}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Button
            key={f.value}
            type="button"
            size="sm"
            variant={filter === f.value ? "default" : "outline"}
            onClick={() => setFilter(f.value)}
          >
            {f.label}
          </Button>
        ))}
      </div>

      {bookings.isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : byDay.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Sin reservas en este período.</p>
      ) : (
        <div className="space-y-6">
          {byDay.map(([day, items]) => (
            <section key={day} className="space-y-2">
              <h2 className="text-sm font-semibold">
                {formatOpDate(day)}{" "}
                <span className="font-normal text-muted-foreground">({items.length})</span>
              </h2>
              <div className="space-y-3">
                {items.map((b) => (
                  <OperatorBookingCard key={b.id} booking={b} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
