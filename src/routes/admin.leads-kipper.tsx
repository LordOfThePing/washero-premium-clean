import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { db } from "@/integrations/db/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Loader2, Shield } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/leads-kipper")({
  component: KipperPage,
});

const STATUSES = ["pending", "contacted", "converted", "discarded"] as const;

function KipperPage() {
  const qc = useQueryClient();

  const detected = useQuery({
    queryKey: ["kipper-bookings"],
    queryFn: async () => {
      const { data, error } = await db
        .from("bookings")
        .select("id, customer_name, customer_phone, customer_email, scheduled_date, scheduled_time, vehicle_type, service_name, notes")
        .ilike("notes", "%kipper%")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data ?? [];
    },
  });

  const stored = useQuery({
    queryKey: ["kipper_leads"],
    queryFn: async () => {
      const { data, error } = await db
        .from("kipper_leads")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const ensureLead = async (b: any, status: string) => {
    const existing = (stored.data ?? []).find((l: any) => l.booking_id === b.id);
    if (existing) {
      await db.from("kipper_leads").update({ status }).eq("id", existing.id);
    } else {
      await db.from("kipper_leads").insert({
        booking_id: b.id,
        full_name: b.customer_name,
        phone: b.customer_phone,
        email: b.customer_email,
        status,
      });
    }
    toast.success("Estado actualizado");
    qc.invalidateQueries({ queryKey: ["kipper_leads"] });
  };

  const statusFor = (bookingId: string) =>
    (stored.data ?? []).find((l: any) => l.booking_id === bookingId)?.status ?? "pending";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Shield className="h-5 w-5" /> Leads Kipper
        </h1>
        <p className="text-sm text-muted-foreground">
          Reservas que mencionan Kipper en las notas.
        </p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Detectados ({detected.data?.length ?? 0})</CardTitle></CardHeader>
        <CardContent>
          {detected.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
            </div>
          ) : (detected.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No hay reservas con interés en Kipper.</p>
          ) : (
            <ul className="divide-y divide-border/60">
              {(detected.data ?? []).map((b: any) => (
                <li key={b.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{b.customer_name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {b.customer_phone} · {b.service_name} · {b.vehicle_type} · {b.scheduled_date}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{statusFor(b.id)}</Badge>
                    <Select value={statusFor(b.id)} onValueChange={(v) => ensureLead(b, v)}>
                      <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
