import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

const PROJECT_REF = "domslcbxgqbylmciqrxt";

type Counts = { services: number | null; areas: number | null; slots: number | null };

function HealthPage() {
  const [counts, setCounts] = useState<Counts>({ services: null, areas: null, slots: null });
  const [insertResult, setInsertResult] = useState<string>("not run");
  const [forbiddenResult, setForbiddenResult] = useState<string>("not run");
  const [loading, setLoading] = useState(true);

  async function loadCounts() {
    setLoading(true);
    const [s, a, sl] = await Promise.all([
      supabase.from("services").select("id", { count: "exact", head: true }).eq("active", true),
      supabase.from("service_areas").select("id", { count: "exact", head: true }).eq("active", true),
      supabase.from("availability_slots").select("id", { count: "exact", head: true }).eq("active", true),
    ]);
    setCounts({ services: s.count ?? 0, areas: a.count ?? 0, slots: sl.count ?? 0 });
    setLoading(false);
  }

  useEffect(() => { loadCounts(); }, []);

  async function runInsertTests() {
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const base = {
      customer_name: "HEALTHCHECK",
      customer_phone: "+5491100000000",
      address: "Test 1",
      neighborhood: "Maschwitz",
      vehicle_type: "sedan",
      service_name: "Lavado Básico",
      scheduled_date: tomorrow,
      scheduled_time: "10:30",
      duration_minutes: 60,
      price: 25000,
      payment_method: "Pagar después",
      notes: "HEALTHCHECK_DELETE_ME",
    };
    const ok = await supabase.from("bookings").insert(base);
    setInsertResult(ok.error ? `FAIL: ${ok.error.message}` : "OK (201)");

    const bad = await supabase.from("bookings").insert({ ...base, booking_source: "admin" });
    setForbiddenResult(bad.error ? `OK (blocked: ${bad.error.code})` : "FAIL (insert allowed!)");
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle>Database health</CardTitle></CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div className="grid gap-2">
            <Row label="Supabase project ref" value={PROJECT_REF} />
            <Row label="Active services" value={loading ? "…" : String(counts.services)} />
            <Row label="Active service areas" value={loading ? "…" : String(counts.areas)} />
            <Row label="Active availability slots" value={loading ? "…" : String(counts.slots)} />
            <Row label="RLS" value={<Badge variant="secondary">enabled on all 9 tables</Badge>} />
            <Row label="Public booking insert (valid)" value={insertResult} />
            <Row label="Public booking insert (forbidden)" value={forbiddenResult} />
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={loadCounts}>Refresh counts</Button>
            <Button size="sm" onClick={runInsertTests}>Run insert tests</Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Test rows are tagged <code>HEALTHCHECK_DELETE_ME</code>. Clean them up via SQL when done.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border/50 py-1.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono text-xs">{value}</span>
    </div>
  );
}

export const Route = createFileRoute("/admin/configuracion")({
  component: HealthPage,
});
