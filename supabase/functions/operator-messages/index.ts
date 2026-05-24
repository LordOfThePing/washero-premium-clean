import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getOperatorGate, isStrictOperatorRole } from "../_shared/operator-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
const ALLOW_UNASSIGNED_TODAY = String(Deno.env.get("OPERATOR_ALLOW_UNASSIGNED_TODAY") ?? "false").toLowerCase() === "true";

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

async function visibleBookingsForToday(gate: { role: string | null; staffId: string | null }) {
  const today = new Date().toISOString().slice(0, 10);
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
    const bookingIds = bookings.map((b) => b.id);
    const bookingById = new Map(bookings.map((b) => [b.id, b]));

    if (action === "list") {
      if (bookingIds.length === 0) return json({ ok: true, conversations: [] });
      const { data: convos, error } = await admin
        .from("botmaker_conversations")
        .select("id, linked_booking_id, customer_name, last_message, last_message_at, last_sender_type")
        .in("linked_booking_id", bookingIds)
        .order("last_message_at", { ascending: false })
        .limit(80);
      if (error) throw error;
      const rows = (convos ?? []).map((c) => {
        const b = bookingById.get(c.linked_booking_id ?? "");
        return {
          conversation_id: c.id,
          booking_id: c.linked_booking_id,
          booking_time: b?.scheduled_time?.slice(0, 5) ?? "—",
          customer_name: c.customer_name ?? b?.customer_name ?? "Cliente",
          latest_message: c.last_message ?? "",
          latest_at: c.last_message_at,
          unread: c.last_sender_type === "user",
          requires_human: b?.booking_status === "needs_review",
        };
      });
      return json({ ok: true, conversations: rows });
    }

    if (action === "timeline") {
      const conversationId = String(body.conversation_id ?? "").trim();
      if (!conversationId) return json({ ok: false, status: "missing_conversation_id" }, 400);
      const { data: convo, error: convoErr } = await admin
        .from("botmaker_conversations")
        .select("id,linked_booking_id")
        .eq("id", conversationId)
        .maybeSingle();
      if (convoErr || !convo) return json({ ok: false, status: "conversation_not_found" }, 404);
      if (!bookingIds.includes(convo.linked_booking_id ?? "")) {
        return json({ ok: false, status: "conversation_forbidden" }, 403);
      }
      const { data: messages, error: msgErr } = await admin
        .from("botmaker_messages")
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
