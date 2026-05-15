import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, RefreshCw, MessageSquare, Phone, AlertTriangle, CheckCircle2, ArrowRight, Sparkles, AlertCircle, Calendar as CalendarIcon, ClipboardList } from "lucide-react";
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

function foldText(v: string) {
  return v.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

const SUMMARY_LABELS = [/nombre\s+completo\s*:/i, /(^|\n|\r)\s*nombre\s*:/i, /direcci[oó]n\s*:/i, /zona\s*:/i, /veh[ií]culo\s*:/i, /servicio\s*:/i, /d[ií]a\s*:/i, /horario\s*:/i, /pago\s*:/i, /confirm[aá]s\s+que\s+est[aá]\s+todo\s+bien/i];
function isSummaryText(text: string) { return SUMMARY_LABELS.filter((re) => re.test(text)).length >= 5; }
function isConfirmText(text: string) {
  const t = foldText(text).replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  const words = ["si", "sisi", "si si", "confirmo", "confirmado", "correcto", "ok", "okay", "dale", "joya", "perfecto", "esta bien", "todo bien", "va", "de una"];
  return !!t && t.length <= 80 && words.some((w) => t === w || t.startsWith(`${w} `) || t.endsWith(` ${w}`));
}
function fieldFrom(text: string, label: string) {
  return text.match(new RegExp(`${label}\\s*:\\s*([^\\n\\r]+)`, "i"))?.[1]?.trim() ?? null;
}
function parseSummaryDebug(text: string) {
  const parsed = {
    customer_name: fieldFrom(text, "Nombre completo") ?? fieldFrom(text, "Nombre"),
    address: fieldFrom(text, "Dirección") ?? fieldFrom(text, "Direccion"),
    neighborhood: fieldFrom(text, "Zona"),
    vehicle_type: fieldFrom(text, "Vehículo") ?? fieldFrom(text, "Vehiculo"),
    service_type: fieldFrom(text, "Servicio"),
    preferred_date: fieldFrom(text, "Día") ?? fieldFrom(text, "Dia"),
    preferred_time: fieldFrom(text, "Horario"),
    payment_method: fieldFrom(text, "Pago"),
  };
  return { parsed, missing: Object.entries(parsed).filter(([, v]) => !v).map(([k]) => k) };
}

function formatWhen(ts: string | null) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" });
}

function MensajesPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hideTest, setHideTest] = useState(true);
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

  const eventStats = useQuery({
    queryKey: ["botmaker", "event-stats"],
    queryFn: async () => {
      const [valid, invalid, lastValid, lastInvalid] = await Promise.all([
        supabase.from("botmaker_events").select("id", { count: "exact", head: true }).eq("auth_valid", true),
        supabase.from("botmaker_events").select("id", { count: "exact", head: true }).eq("auth_valid", false),
        supabase.from("botmaker_events").select("created_at").eq("auth_valid", true).order("created_at", { ascending: false }).limit(1).maybeSingle(),
        supabase.from("botmaker_events").select("created_at").eq("auth_valid", false).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      ]);
      return {
        valid_count: valid.count ?? 0,
        invalid_count: invalid.count ?? 0,
        last_valid_event: lastValid.data?.created_at ?? null,
        last_invalid_event: lastInvalid.data?.created_at ?? null,
      };
    },
  });

  const allList = conversations.data ?? [];
  const list = useMemo(
    () => (hideTest ? allList.filter((c) => !isTestConvo(c)) : allList),
    [allList, hideTest]
  );
  const testCount = allList.filter(isTestConvo).length;
  const selected = list.find((c) => c.id === selectedId) ?? allList.find((c) => c.id === selectedId) ?? null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <MessageSquare className="h-6 w-6" /> Mensajes / Botmaker
          </h1>
          <p className="text-sm text-muted-foreground">Conversaciones y eventos recibidos desde Botmaker.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant={hideTest ? "default" : "outline"}
            onClick={() => setHideTest((v) => !v)}
            title="Ocultar conversaciones marcadas como prueba"
          >
            {hideTest ? "Mostrando reales" : "Mostrando todo"} ({testCount} test)
          </Button>
          <Button size="sm" variant="outline" onClick={() => {
            qc.invalidateQueries({ queryKey: ["botmaker"] });
          }}>
            <RefreshCw className="mr-2 h-4 w-4" /> Actualizar
          </Button>
        </div>
      </div>

      {(eventStats.data?.invalid_count ?? 0) > 0 && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-destructive mt-0.5" />
          <div className="space-y-1">
            <p>Hay {eventStats.data?.invalid_count} eventos rechazados por token inválido.</p>
            <p className="text-xs text-muted-foreground">Header esperado: <code className="font-mono">auth-bm-token</code>. El token de seguridad de Botmaker debe coincidir exactamente con <code className="font-mono">BOTMAKER_WEBHOOK_SECRET</code> en Supabase.</p>
            <p className="text-xs text-muted-foreground">Último inválido: {formatWhen(eventStats.data?.last_invalid_event ?? null)} · Válidos: {eventStats.data?.valid_count ?? 0} · Último válido: {formatWhen(eventStats.data?.last_valid_event ?? null)}</p>
          </div>
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
                        {isTestConvo(c) && <Badge variant="outline" className="text-[10px] border-amber-400 text-amber-700 dark:text-amber-300">test</Badge>}
                        {c.linked_booking_id && <Badge className="text-[10px] gap-1"><Sparkles className="h-3 w-3" /> auto-reservada</Badge>}
                        {!c.linked_booking_id && c.linked_booking_request_id && <Badge variant="secondary" className="text-[10px]">requiere revisión</Badge>}
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
        {bookingRequest.data && (() => {
          const br = bookingRequest.data as any;
          const autoBooked = !!br.linked_booking_id;
          const fallback = br.raw_payload?.fallback_reason as string | undefined;
          const fallbackLabel: Record<string, string> = {
            missing_fields: "Datos incompletos",
            invalid_service: "Servicio no reconocido",
            invalid_vehicle: "Vehículo inválido",
            invalid_payment: "Pago inválido",
            invalid_date: "Fecha inválida",
            invalid_time: "Horario inválido",
            past_date: "Fecha pasada",
            slot_unavailable: "Slot no disponible",
            slot_full: "Slot lleno",
            duplicate: "Reserva duplicada",
            invalid_extra: "Extra inválido",
            server_error: "Error interno",
          };
          return (
          <div className="rounded-md border border-border/60 bg-muted/30 p-3 space-y-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="text-sm font-medium flex items-center gap-2 flex-wrap">
                Solicitud de reserva
                {autoBooked ? (
                  <Badge className="gap-1"><Sparkles className="h-3 w-3" /> Auto-reservada</Badge>
                ) : br.status === "converted" ? (
                  <Badge className="gap-1"><CheckCircle2 className="h-3 w-3" /> Convertida</Badge>
                ) : (
                  <Badge variant="secondary" className="gap-1"><AlertCircle className="h-3 w-3" /> Requiere revisión</Badge>
                )}
                {fallback && !autoBooked && (
                  <Badge variant="outline" className="text-[10px]">{fallbackLabel[fallback] ?? fallback}</Badge>
                )}
                {br.is_test && <Badge variant="outline" className="text-[10px] border-amber-400 text-amber-700 dark:text-amber-300">test</Badge>}
              </div>
              {!autoBooked && br.status !== "converted" && (
                <Button size="sm" onClick={() => setApproveOpen(true)}>
                  Aprobar y crear reserva <ArrowRight className="ml-1 h-3 w-3" />
                </Button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              <Field label="Cliente" v={br.customer_name} />
              <Field label="Teléfono" v={br.customer_phone} />
              <Field label="Dirección" v={br.address} />
              <Field label="Zona" v={br.neighborhood} />
              <Field label="Vehículo" v={br.vehicle_type} />
              <Field label="Servicio" v={br.service_type} />
              <Field label="Día" v={br.preferred_date} />
              <Field label="Horario" v={br.preferred_time} />
              <Field label="Pago" v={br.payment_method} />
            </div>
            {autoBooked && (
              <div className="flex flex-wrap gap-2 pt-1">
                <Button asChild size="sm" variant="outline">
                  <Link to="/admin/reservas"><ClipboardList className="mr-1 h-3 w-3" /> Ver en Reservas</Link>
                </Button>
                <Button asChild size="sm" variant="outline">
                  <Link to="/admin/calendario"><CalendarIcon className="mr-1 h-3 w-3" /> Ver en Calendario</Link>
                </Button>
              </div>
            )}
            {Array.isArray(br.missing_fields) && br.missing_fields.length > 0 && !autoBooked && (
              <div className="text-[11px] text-muted-foreground">
                Faltan: {br.missing_fields.join(", ")}
              </div>
            )}
          </div>
          );
        })()}

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
        notes: [bookingRequest.is_test ? "[TEST]" : null, form.notes || null].filter(Boolean).join(" ") || null,
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
