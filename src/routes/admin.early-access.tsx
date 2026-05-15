import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Plus, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/early-access")({
  component: EarlyAccessPage,
});

const STATUSES = ["new", "contacted", "converted", "discarded"] as const;
type Status = (typeof STATUSES)[number];

function EarlyAccessPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<Status | "all">("all");
  const [open, setOpen] = useState(false);

  const list = useQuery({
    queryKey: ["early_access_leads"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("early_access_leads")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return data ?? [];
    },
  });

  const filtered = (list.data ?? []).filter((r: any) => {
    if (statusFilter !== "all" && r.status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return [r.full_name, r.phone, r.email, r.neighborhood]
        .filter(Boolean)
        .some((v: string) => v.toLowerCase().includes(q));
    }
    return true;
  });

  const updateStatus = async (id: string, status: Status) => {
    const { error } = await supabase
      .from("early_access_leads")
      .update({ status })
      .eq("id", id);
    if (error) {
      toast.error("No se pudo actualizar", { description: error.message });
      return;
    }
    toast.success("Estado actualizado");
    qc.invalidateQueries({ queryKey: ["early_access_leads"] });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Sparkles className="h-5 w-5" /> Early Access
          </h1>
          <p className="text-sm text-muted-foreground">Captura y seguimiento de leads.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="mr-1 h-4 w-4" /> Nuevo lead</Button>
          </DialogTrigger>
          <NewLeadDialog onClose={() => setOpen(false)} />
        </Dialog>
      </div>

      <Card>
        <CardContent className="grid gap-3 p-4 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <Label className="text-xs">Buscar</Label>
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nombre, teléfono, email…" />
          </div>
          <div>
            <Label className="text-xs">Estado</Label>
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Leads ({filtered.length})</CardTitle></CardHeader>
        <CardContent>
          {list.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin leads.</p>
          ) : (
            <ul className="divide-y divide-border/60">
              {filtered.map((r: any) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{r.full_name || "(sin nombre)"}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {[r.phone, r.email, r.neighborhood].filter(Boolean).join(" · ")}
                    </p>
                    {r.notes && <p className="text-xs text-muted-foreground">{r.notes}</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{r.source}</Badge>
                    <Select value={r.status} onValueChange={(v) => updateStatus(r.id, v as Status)}>
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

function NewLeadDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [full_name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [neighborhood, setN] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    const { error } = await supabase.from("early_access_leads").insert({
      full_name, phone, email, neighborhood, notes, source: "manual",
    });
    setSaving(false);
    if (error) {
      toast.error("No se pudo crear", { description: error.message });
      return;
    }
    toast.success("Lead creado");
    qc.invalidateQueries({ queryKey: ["early_access_leads"] });
    onClose();
  };

  return (
    <DialogContent>
      <DialogHeader><DialogTitle>Nuevo lead</DialogTitle></DialogHeader>
      <div className="grid gap-3">
        <div><Label>Nombre</Label><Input value={full_name} onChange={(e) => setName(e.target.value)} /></div>
        <div><Label>Teléfono</Label><Input value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
        <div><Label>Email</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <div><Label>Zona</Label><Input value={neighborhood} onChange={(e) => setN(e.target.value)} /></div>
        <div><Label>Notas</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button onClick={submit} disabled={saving}>
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Guardar
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
