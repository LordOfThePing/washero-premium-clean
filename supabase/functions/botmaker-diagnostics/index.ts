// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("BOTMAKER_WEBHOOK_SECRET") ?? "";

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

async function isAdmin(authHeader: string | null) {
  if (!authHeader) return false;
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data } = await userClient.auth.getUser();
  if (!data.user) return false;
  const { data: row } = await admin
    .from("admin_users").select("active").eq("user_id", data.user.id).maybeSingle();
  return !!row?.active;
}

async function status() {
  const [evAll, convAll, msgAll, lastValid, lastInvalid, lastConv, lastMsg, lastBR] = await Promise.all([
    admin.from("botmaker_events").select("id", { count: "exact", head: true }),
    admin.from("botmaker_conversations").select("id", { count: "exact", head: true }),
    admin.from("botmaker_messages").select("id", { count: "exact", head: true }),
    admin.from("botmaker_events").select("created_at").eq("auth_valid", true).order("created_at",{ascending:false}).limit(1).maybeSingle(),
    admin.from("botmaker_events").select("created_at").eq("auth_valid", false).order("created_at",{ascending:false}).limit(1).maybeSingle(),
    admin.from("botmaker_conversations").select("created_at, customer_phone").order("created_at",{ascending:false}).limit(1).maybeSingle(),
    admin.from("botmaker_messages").select("created_at, sender_type").order("created_at",{ascending:false}).limit(1).maybeSingle(),
    admin.from("booking_requests").select("created_at, id").eq("source","botmaker").order("created_at",{ascending:false}).limit(1).maybeSingle(),
  ]);
  return {
    secret_configured: !!WEBHOOK_SECRET,
    counts: {
      events: evAll.count ?? 0,
      conversations: convAll.count ?? 0,
      messages: msgAll.count ?? 0,
    },
    last_valid_event: lastValid.data?.created_at ?? null,
    last_invalid_event: lastInvalid.data?.created_at ?? null,
    last_conversation: lastConv.data ?? null,
    last_message: lastMsg.data ?? null,
    last_booking_request: lastBR.data ?? null,
  };
}

async function callWebhook(body: any, withToken: boolean) {
  const url = `${SUPABASE_URL}/functions/v1/botmaker-webhook`;
  const headers: Record<string,string> = { "Content-Type": "application/json" };
  if (withToken) headers["auth-bm-token"] = WEBHOOK_SECRET;
  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  return { status: res.status, body: await res.text() };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const url = new URL(req.url);
  let action = url.searchParams.get("action") ?? "status";
  if (req.method === "POST") {
    try {
      const body = await req.json();
      if (body?.action) action = body.action;
    } catch { /* ignore */ }
  }
  const authHeader = req.headers.get("authorization");

  if (!(await isAdmin(authHeader))) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    if (action === "status") {
      return new Response(JSON.stringify(await status()), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (action === "test_no_token") {
      const r = await callWebhook({ is_test: true, _why: "no token test" }, false);
      return new Response(JSON.stringify({ ok: r.status === 401, ...r }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (action === "test_message") {
      const convoId = `test-conv-${Date.now()}`;
      const r = await callWebhook({
        is_test: true,
        eventType: "message",
        chatId: convoId,
        realWhatsAppId: "5491100000000",
        fullName: "Test Botmaker",
        senderType: "user",
        message: "Hola, soy un mensaje de prueba",
        channel: "whatsapp",
      }, true);
      return new Response(JSON.stringify({ ok: r.status === 200, conversation_id: convoId, ...r }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (action === "test_booking") {
      const convoId = `test-conv-${Date.now()}`;
      const summary = `Perfecto, tengo estos datos:
Nombre completo: Cliente Prueba
Dirección: Av. Test 123
Zona: Maschwitz
Vehículo: SUV
Servicio: Lavado Completo
Día: mañana
Horario: 16 hs
Pago: Pagar después
¿Confirmás que está todo bien?`;
      const r1 = await callWebhook({
        is_test: true,
        eventType: "message",
        chatId: convoId,
        realWhatsAppId: "5491100000001",
        fullName: "Cliente Prueba",
        senderType: "bot",
        message: summary,
        channel: "whatsapp",
      }, true);
      // brief delay
      await new Promise(r => setTimeout(r, 250));
      const r2 = await callWebhook({
        is_test: true,
        eventType: "message",
        chatId: convoId,
        realWhatsAppId: "5491100000001",
        fullName: "Cliente Prueba",
        senderType: "user",
        message: "sí, confirmo",
        channel: "whatsapp",
      }, true);
      return new Response(JSON.stringify({ ok: r1.status === 200 && r2.status === 200, conversation_id: convoId, summary: r1, confirm: r2 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: String(e?.message ?? e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
