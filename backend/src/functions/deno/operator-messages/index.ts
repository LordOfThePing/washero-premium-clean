// @ts-nocheck -- ported verbatim from supabase/functions; not our source of truth for types
import { createClient } from "@supabase/supabase-js";
import { getOperatorGate, isStrictOperatorRole } from "../_shared/operator-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY!;
const ALLOW_UNASSIGNED_TODAY = String(process.env.OPERATOR_ALLOW_UNASSIGNED_TODAY ?? "false").toLowerCase() === "true";

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

type Payload = {
  action?: "list" | "timeline";
  conversation_id?: string;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isOperationalForOperator(
  convo: {
    routing_type: string | null;
    routing_assigned_operator_id: string | null;
    linked_booking_id: string | null;
  },
  gate: { role: string | null; staffId: string | null },
  bookingIds: Set<string>,
  bookingById: Map<string, { assigned_operator_id: string | null }>,
) {
  if (convo.routing_type === "commercial" || convo.routing_type === "supplier") {
    return false;
  }
  if (convo.routing_type === "unknown") return false;

  const bookingId = convo.linked_booking_id;
  if (!bookingId || !bookingIds.has(bookingId)) return false;

  const booking = bookingById.get(bookingId);
  if (isStrictOperatorRole(gate.role) && gate.staffId) {
    if (booking?.assigned_operator_id !== gate.staffId) return false;
    if (
      convo.routing_assigned_operator_id &&
      convo.routing_assigned_operator_id !== gate.staffId
    ) {
      return false;
    }
  }

  return convo.routing_type === "operational" || convo.routing_type === null;
}

async function visibleBookingsForToday(gate: { role: string | null; staffId: string | null }) {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
  let q = admin
    .from("bookings")
    .select("id, assigned_operator_id, scheduled_time, customer_name, booking_status")
    .eq("scheduled_date", today)
    .neq("booking_status", "cancelled");
  if (isStrictOperatorRole(gate.role) && gate.staffId) {
    if (ALLOW_UNASSIGNED_TODAY) {
      q = q.or(`assigned_operator_id.eq.${gate.staffId},assigned_operator_id.is.null`);
    } else {
      q = q.eq("assigned_operator_id", gate.staffId);
    }
  }
  const { data, error } = await q.order("scheduled_time", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, status: "method_not_allowed" }, 405);

  const gate = await getOperatorGate({
    authHeader: req.headers.get("authorization"),
    supabaseUrl: SUPABASE_URL,
    anonKey: ANON_KEY,
    admin,
  });
  if (!gate.ok) return json({ ok: false, status: "forbidden" }, 403);

  let body: Payload;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, status: "invalid_json" }, 400);
  }

  try {
    const action = body.action ?? "list";
    const bookings = await visibleBookingsForToday(gate);
    const bookingIds = new Set(bookings.map((b) => b.id));
    const bookingById = new Map(bookings.map((b) => [b.id, b]));

    if (action === "list") {
      if (bookingIds.size === 0) return json({ ok: true, conversations: [] });

      const { data: convos, error } = await admin
        .from("whatsapp_conversations")
        .select(
          "id, linked_booking_id, customer_name, last_message, last_message_at, last_sender_type, routing_type, routing_assigned_operator_id, routing_requires_human",
        )
        .in("linked_booking_id", [...bookingIds])
        .order("last_message_at", { ascending: false })
        .limit(120);
      if (error) throw error;

      const rows = (convos ?? [])
        .filter((c) => isOperationalForOperator(c, gate, bookingIds, bookingById))
        .map((c) => {
          const b = bookingById.get(c.linked_booking_id ?? "");
          return {
            conversation_id: c.id,
            booking_id: c.linked_booking_id,
            booking_time: b?.scheduled_time?.slice(0, 5) ?? "—",
            customer_name: c.customer_name ?? b?.customer_name ?? "Cliente",
            latest_message: c.last_message ?? "",
            latest_at: c.last_message_at,
            unread: c.last_sender_type === "user",
            requires_human: c.routing_requires_human === true,
            routing_type: c.routing_type ?? "operational",
          };
        });

      return json({ ok: true, conversations: rows });
    }

    if (action === "timeline") {
      const conversationId = String(body.conversation_id ?? "").trim();
      if (!conversationId) return json({ ok: false, status: "missing_conversation_id" }, 400);
      const { data: convo, error: convoErr } = await admin
        .from("whatsapp_conversations")
        .select(
          "id,linked_booking_id,routing_type,routing_assigned_operator_id,routing_requires_human",
        )
        .eq("id", conversationId)
        .maybeSingle();
      if (convoErr || !convo) return json({ ok: false, status: "conversation_not_found" }, 404);
      if (!isOperationalForOperator(convo, gate, bookingIds, bookingById)) {
        return json({ ok: false, status: "conversation_forbidden" }, 403);
      }
      const { data: messages, error: msgErr } = await admin
        .from("whatsapp_messages")
        .select("id,created_at,direction,sender_type,message_text")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true })
        .limit(120);
      if (msgErr) throw msgErr;
      return json({ ok: true, messages: messages ?? [] });
    }

    return json({ ok: false, status: "invalid_action" }, 400);
  } catch (e) {
    console.error("[operator-messages]", e);
    return json({ ok: false, status: "server_error" }, 500);
  }
});
