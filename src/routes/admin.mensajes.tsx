import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, RefreshCw, MessageSquare, Phone, AlertTriangle, CheckCircle2, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/admin/mensajes")({
  component: MensajesPage,
});

type Conversation = {
  id: string;
  botmaker_conversation_id: string | null;
  customer_phone: string | null;
  customer_name: string | null;
  channel: string | null;
  last_message: string | null;
  last_message_at: string | null;
  last_sender_type: string | null;
  linked_customer_id: string | null;
  linked_booking_request_id: string | null;
  linked_booking_id: string | null;
  raw_payload: any;
};

function isTestConvo(c: Conversation) {
  return c.raw_payload?.is_test === true;
}

type Message = {
  id: string;
  conversation_id: string;
  sender_type: string | null;
  message_text: string | null;
  created_at: string;
  raw_payload: any;
};

function formatWhen(ts: string | null) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" });
}

function MensajesPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const qc = useQueryClient();

  const conversations = useQuery({
    queryKey: ["botmaker", "conversations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("botmaker_conversations")
        .select("*")
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .limit(200);
      if (error) throw error;
      return data as Conversation[];
    },
  });

  const invalidEvents = useQuery({
    queryKey: ["botmaker", "invalid-count"],
    queryFn: async () => {
      const { count } = await supabase
        .from("botmaker_events")
        .select("id", { count: "exact", head: true })
        .eq("auth_valid", false);
      return count ?? 0;
    },
  });

  const list = conversations.data ?? [];
  const selected = list.find((c) => c.id === selectedId) ?? null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <MessageSquare className="h-6 w-6" /> Mensajes / Botmaker
          </h1>
          <p className="text-sm text-muted-foreground">Conversaciones y eventos recibidos desde Botmaker.</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => {
          qc.invalidateQueries({ queryKey: ["botmaker"] });
        }}>
          <RefreshCw className="mr-2 h-4 w-4" /> Actualizar
        </Button>
      </div>

      {(invalidEvents.data ?? 0) > 0 && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-destructive" />
          Hay {invalidEvents.data} eventos rechazados por token inválido. Revisá BOTMAKER_WEBHOOK_SECRET.
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Conversaciones</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {conversations.isLoading ? (
              <div className="p-6 flex justify-center"><Loader2 className="h-5 w-5 animate-spin" /></div>
            ) : list.length === 0 ? (
              <div className="p-6 text-sm text-muted-foreground">
                No hay conversaciones todavía. Revisá que el webhook de Botmaker esté configurado.
              </div>
            ) : (
              <ul className="divide-y divide-border/60 max-h-[70vh] overflow-y-auto">
                {list.map((c) => (
                  <li key={c.id}>
                    <button
                      onClick={() => setSelectedId(c.id)}
                      className={`w-full text-left p-3 hover:bg-muted/50 ${selectedId === c.id ? "bg-muted" : ""}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-medium truncate">{c.customer_name || c.customer_phone || "Sin nombre"}</div>
                        <span className="text-[10px] text-muted-foreground shrink-0">{formatWhen(c.last_message_at)}</span>
                      </div>
                      <div className="text-xs text-muted-foreground flex items-center gap-1">
                        <Phone className="h-3 w-3" /> {c.customer_phone || "—"} · {c.channel || "—"}
                      </div>
                      <div className="text-xs text-muted-foreground truncate mt-0.5">{c.last_message || "—"}</div>
                      <div className="flex gap-1 mt-1 flex-wrap">
                        {c.linked_booking_request_id && <Badge variant="secondary" className="text-[10px]">solicitud</Badge>}
                        {c.linked_booking_id && <Badge className="text-[10px]">reserva</Badge>}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <div>
          {selected ? (
            <ConversationDetail conversation={selected} />
          ) : (
            <Card><CardContent className="p-8 text-sm text-muted-foreground text-center">Seleccioná una conversación.</CardContent></Card>
          )}
        </div>
      </div>
    </div>
  );
}

function ConversationDetail({ conversation }: { conversation: Conversation }) {
  const [showRaw, setShowRaw] = useState(false);
  const [approveOpen, setApproveOpen] = useState(false);

  const messages = useQuery({
    queryKey: ["botmaker", "messages", conversation.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("botmaker_messages")
        .select("*")
        .eq("conversation_id", conversation.id)
        .order("created_at", { ascending: true })
        .limit(500);
      if (error) throw error;
      return data as Message[];
    },
  });

  const bookingRequest = useQuery({
    queryKey: ["botmaker", "br", conversation.linked_booking_request_id],
    enabled: !!conversation.linked_booking_request_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("booking_requests")
        .select("*")
        .eq("id", conversation.linked_booking_request_id!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span className="text-base">{conversation.customer_name || conversation.customer_phone || "Conversación"}</span>
          <span className="text-xs text-muted-foreground">{conversation.channel || ""}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {bookingRequest.data && (
          <div className="rounded-md border border-border/60 bg-muted/30 p-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium">Solicitud de reserva ({bookingRequest.data.status})</div>
              {bookingRequest.data.status !== "converted" ? (
                <Button size="sm" onClick={() => setApproveOpen(true)}>
                  Aprobar y crear reserva <ArrowRight className="ml-1 h-3 w-3" />
                </Button>
              ) : (
                <Badge className="gap-1"><CheckCircle2 className="h-3 w-3" /> Convertida</Badge>
              )}
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs mt-2">
              <Field label="Cliente" v={bookingRequest.data.customer_name} />
              <Field label="Teléfono" v={bookingRequest.data.customer_phone} />
              <Field label="Dirección" v={bookingRequest.data.address} />
              <Field label="Zona" v={bookingRequest.data.neighborhood} />
              <Field label="Vehículo" v={bookingRequest.data.vehicle_type} />
              <Field label="Servicio" v={bookingRequest.data.service_type} />
              <Field label="Día" v={bookingRequest.data.preferred_date} />
              <Field label="Horario" v={bookingRequest.data.preferred_time} />
              <Field label="Pago" v={bookingRequest.data.payment_method} />
            </div>
          </div>
        )}

        <div className="space-y-2 max-h-[55vh] overflow-y-auto">
          {messages.isLoading && <Loader2 className="h-5 w-5 animate-spin" />}
          {(messages.data ?? []).map((m) => (
            <MessageBubble key={m.id} m={m} />
          ))}
          {messages.data?.length === 0 && <p className="text-sm text-muted-foreground">Sin mensajes.</p>}
        </div>

        <div>
          <Button variant="ghost" size="sm" onClick={() => setShowRaw((v) => !v)}>
            {showRaw ? "Ocultar" : "Ver"} payload crudo
          </Button>
          {showRaw && (
            <pre className="mt-2 overflow-x-auto rounded bg-muted p-2 text-[10px]">
              {JSON.stringify(conversation, null, 2)}
            </pre>
          )}
        </div>
      </CardContent>

      {bookingRequest.data && (
        <ApproveDialog
          open={approveOpen}
          onClose={() => setApproveOpen(false)}
          bookingRequest={bookingRequest.data}
          conversationId={conversation.id}
        />
      )}
    </Card>
  );
}

function Field({ label, v }: { label: string; v: any }) {
  return (
    <div>
      <span className="text-muted-foreground">{label}: </span>
      <span>{v ?? "—"}</span>
    </div>
  );
}

function MessageBubble({ m }: { m: Message }) {
  const isUser = m.sender_type === "user";
  const isBot = m.sender_type === "bot";
  const isAgent = m.sender_type === "agent";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
        isUser ? "bg-primary text-primary-foreground"
        : isBot ? "bg-muted"
        : isAgent ? "bg-accent"
        : "bg-secondary text-secondary-foreground"
      }`}>
        <div className="text-[10px] opacity-70 mb-0.5 capitalize">{m.sender_type || "system"} · {formatWhen(m.created_at)}</div>
        <div className="whitespace-pre-wrap break-words">{m.message_text || "(sin texto)"}</div>
      </div>
    </div>
  );
}

function ApproveDialog({
  open, onClose, bookingRequest, conversationId,
}: {
  open: boolean;
  onClose: () => void;
  bookingRequest: any;
  conversationId: string;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    customer_name: bookingRequest.customer_name ?? "",
    customer_phone: bookingRequest.customer_phone ?? "",
    address: bookingRequest.address ?? "",
    neighborhood: bookingRequest.neighborhood ?? "",
    vehicle_type: bookingRequest.vehicle_type ?? "",
    service_type: bookingRequest.service_type ?? "",
    preferred_date: bookingRequest.preferred_date ?? "",
    preferred_time: bookingRequest.preferred_time ?? "",
    payment_method: bookingRequest.payment_method ?? "Pagar después",
    notes: "",
  });

  const services = useQuery({
    queryKey: ["services-active"],
    queryFn: async () => {
      const { data, error } = await supabase.from("services").select("*").eq("active", true);
      if (error) throw error;
      return data;
    },
  });

  const mutation = useMutation({
    mutationFn: async () => {
      const required = ["customer_name","customer_phone","address","neighborhood","vehicle_type","service_type","preferred_date","preferred_time"] as const;
      for (const k of required) if (!form[k]) throw new Error(`Falta ${k}`);

      const svc = (services.data ?? []).find((s: any) =>
        s.name?.toLowerCase() === String(form.service_type).toLowerCase()
      ) ?? (services.data ?? [])[0];
      if (!svc) throw new Error("No hay servicios activos");

      // Find or create customer
      let customerId: string | null = null;
      const { data: existing } = await supabase
        .from("customers").select("id").eq("phone", form.customer_phone).maybeSingle();
      if (existing) {
        customerId = existing.id;
        await supabase.from("customers").update({
          full_name: form.customer_name,
          address: form.address,
          neighborhood: form.neighborhood,
        }).eq("id", existing.id);
      } else {
        const { data: created } = await supabase.from("customers").insert({
          full_name: form.customer_name,
          phone: form.customer_phone,
          address: form.address,
          neighborhood: form.neighborhood,
        }).select("id").maybeSingle();
        customerId = created?.id ?? null;
      }

      const { data: booking, error: bErr } = await supabase.from("bookings").insert({
        customer_id: customerId,
        customer_name: form.customer_name,
        customer_phone: form.customer_phone,
        address: form.address,
        neighborhood: form.neighborhood,
        vehicle_type: form.vehicle_type,
        service_id: svc.id,
        service_name: svc.name,
        price: svc.base_price,
        duration_minutes: svc.duration_minutes,
        scheduled_date: form.preferred_date,
        scheduled_time: form.preferred_time,
        payment_method: form.payment_method,
        payment_status: "pending",
        booking_status: "confirmed",
        booking_source: "botmaker",
        notes: form.notes || null,
      }).select("id").single();
      if (bErr) throw bErr;

      await supabase.from("booking_requests")
        .update({ status: "converted", linked_booking_id: booking.id })
        .eq("id", bookingRequest.id);

      await supabase.from("botmaker_conversations")
        .update({ linked_booking_id: booking.id })
        .eq("id", conversationId);

      return booking;
    },
    onSuccess: () => {
      toast.success("Reserva creada");
      qc.invalidateQueries({ queryKey: ["botmaker"] });
      onClose();
    },
    onError: (e: any) => toast.error(e?.message ?? "Error al aprobar"),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Aprobar y crear reserva</DialogTitle>
          <DialogDescription>Revisá los datos antes de crear la reserva en el calendario.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3 text-sm">
          {([
            ["customer_name","Nombre"], ["customer_phone","Teléfono"],
            ["address","Dirección"], ["neighborhood","Zona"],
            ["preferred_date","Fecha (YYYY-MM-DD)"], ["preferred_time","Hora (HH:MM)"],
          ] as const).map(([k,lbl]) => (
            <div key={k}>
              <Label className="text-xs">{lbl}</Label>
              <Input value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
            </div>
          ))}
          <div>
            <Label className="text-xs">Vehículo</Label>
            <Select value={form.vehicle_type} onValueChange={(v) => setForm({ ...form, vehicle_type: v })}>
              <SelectTrigger><SelectValue placeholder="Vehículo" /></SelectTrigger>
              <SelectContent>
                {["Auto","SUV","Pick-up"].map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Servicio</Label>
            <Select value={form.service_type} onValueChange={(v) => setForm({ ...form, service_type: v })}>
              <SelectTrigger><SelectValue placeholder="Servicio" /></SelectTrigger>
              <SelectContent>
                {(services.data ?? []).map((s: any) => <SelectItem key={s.id} value={s.name}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Pago</Label>
            <Select value={form.payment_method} onValueChange={(v) => setForm({ ...form, payment_method: v })}>
              <SelectTrigger><SelectValue placeholder="Pago" /></SelectTrigger>
              <SelectContent>
                {["Pagar después","MercadoPago","Transferencia"].map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2">
            <Label className="text-xs">Notas</Label>
            <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Crear reserva
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
