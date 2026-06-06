import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { OperatorWhatsappActions } from "@/components/operator/OperatorWhatsappActions";
import {
  OPERATOR_BOOKING_SELECT,
  getWorkflowPhase,
  type OperatorBooking,
  type OperatorWorkflowPhase,
} from "@/lib/operator";

type OperatorConversation = {
  conversation_id: string;
  booking_id: string;
  booking_time: string;
  customer_name: string;
  latest_message: string;
  latest_at: string | null;
  unread: boolean;
  requires_human: boolean;
};

type OperatorMessage = {
  id: string;
  created_at: string;
  direction: string | null;
  sender_type: string | null;
  message_text: string | null;
};

export const Route = createFileRoute("/operator/mensajes")({
  component: OperatorMensajesPage,
});

function OperatorMensajesPage() {
  const [search, setSearch] = useState("");
  const [activeBookingId, setActiveBookingId] = useState<string | null>(null);

  const conversations = useQuery({
    queryKey: ["operator", "messages", "list"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("operator-messages", {
        body: { action: "list" },
      });
      if (error) throw error;
      const rows = (data?.conversations ?? []) as OperatorConversation[];
      return rows;
    },
  });

  const bookingIds = useMemo(() => {
    const ids = (conversations.data ?? []).map((c) => c.booking_id).filter(Boolean);
    return [...new Set(ids)].sort();
  }, [conversations.data]);

  const bookingsContext = useQuery({
    queryKey: ["operator", "messages", "bookings-context", bookingIds.join(",")],
    enabled: bookingIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bookings")
        .select(OPERATOR_BOOKING_SELECT)
        .in("id", bookingIds);
      if (error) throw error;
      const map = new Map<string, OperatorBooking>();
      for (const row of data ?? []) {
        map.set(row.id, row as OperatorBooking);
      }
      return map;
    },
  });

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return conversations.data ?? [];
    return (conversations.data ?? []).filter((c) =>
      `${c.customer_name} ${c.latest_message}`.toLowerCase().includes(term),
    );
  }, [conversations.data, search]);

  const selected =
    (conversations.data ?? []).find((c) => c.booking_id === activeBookingId) ?? null;
  const selectedBooking = selected ? bookingsContext.data?.get(selected.booking_id) : undefined;

  const whatsappPhase: OperatorWorkflowPhase | undefined = selectedBooking
    ? getWorkflowPhase(selectedBooking)
    : selected?.requires_human
      ? "issue"
      : undefined;

  const timeline = useQuery({
    queryKey: ["operator", "messages", "timeline", selected?.conversation_id],
    enabled: !!selected?.conversation_id,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("operator-messages", {
        body: { action: "timeline", conversation_id: selected!.conversation_id },
      });
      if (error) throw error;
      return (data?.messages ?? []) as OperatorMessage[];
    },
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Mensajes</h1>
        <p className="text-sm text-muted-foreground">
          Conversaciones de reservas de hoy asignadas a vos.
        </p>
      </div>

      <Input
        placeholder="Buscar por cliente o mensaje"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {conversations.isLoading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No hay conversaciones operativas para hoy.
        </p>
      ) : (
        <div className="space-y-3">
          {filtered.map((c) => (
            <Card
              key={c.conversation_id}
              className={c.booking_id === selected?.booking_id ? "border-primary" : ""}
            >
              <CardContent className="space-y-2 p-3">
                <button
                  type="button"
                  onClick={() => setActiveBookingId(c.booking_id)}
                  className="w-full text-left"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium">{c.customer_name}</p>
                    {c.unread ? <span className="text-[10px] text-primary">Nuevo</span> : null}
                  </div>
                  <p className="line-clamp-1 text-xs text-muted-foreground">{c.latest_message}</p>
                  <p className="text-xs text-muted-foreground">{c.booking_time}</p>
                </button>
                <div className="flex gap-2">
                  <Button asChild variant="outline" size="sm" className="h-8">
                    <Link
                      to="/operator/reserva/$bookingId"
                      params={{ bookingId: c.booking_id }}
                      search={{ from: "mensajes" }}
                    >
                      Ver reserva
                    </Link>
                  </Button>
                  {c.requires_human ? (
                    <span className="inline-flex items-center rounded-full bg-amber-100 px-2 text-[10px] text-amber-800">
                      Requiere revisión
                    </span>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {selected && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Conversación — {selected.customer_name}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {timeline.isLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Cargando mensajes...
              </div>
            ) : (
              <div className="max-h-52 space-y-2 overflow-y-auto rounded-md border bg-muted/20 p-2">
                {(timeline.data ?? []).map((m) => (
                  <div key={m.id} className="rounded border bg-background p-2 text-xs">
                    <p className="font-medium">{m.sender_type ?? m.direction ?? "mensaje"}</p>
                    <p className="text-muted-foreground">{m.message_text ?? "—"}</p>
                  </div>
                ))}
              </div>
            )}
            <OperatorWhatsappActions
              bookingId={selected.booking_id}
              booking={selectedBooking}
              phase={whatsappPhase}
              compact
              onSent={() => {
                conversations.refetch();
                timeline.refetch();
              }}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
