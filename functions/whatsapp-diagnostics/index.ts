// Admin-only diagnostics for the WhatsApp transport: n8n Outbound Gateway config presence, recent
// send stats from communication_logs, and inbox counts. Replaces the old Botmaker-specific
// diagnostics function (which reported Botmaker API token / template-send config, retired along
// with the vendor integration).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const API_URL = Deno.env.get("API_URL")!;
const SERVICE_ROLE = Deno.env.get("SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("ANON_KEY")!;

const admin = createClient(API_URL, SERVICE_ROLE, { auth: { persistSession: false } });

async function isAdmin(authHeader: string | null) {
  if (!authHeader) return false;
  const userClient = createClient(API_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data } = await userClient.auth.getUser();
  if (!data.user) return false;
  const { data: row } = await admin
    .from("admin_users").select("active").eq("user_id", data.user.id).maybeSingle();
  return !!row?.active;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function logStatus(row: { raw_payload?: unknown }) {
  const p = (row.raw_payload ?? {}) as Record<string, unknown>;
  return (p.status as string) ?? "unknown";
}

async function status() {
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [convAll, msgAll, lastConv, lastMsg] = await Promise.all([
    admin.from("whatsapp_conversations").select("id", { count: "exact", head: true }),
    admin.from("whatsapp_messages").select("id", { count: "exact", head: true }),
    admin.from("whatsapp_conversations").select("created_at, customer_phone").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("whatsapp_messages").select("created_at, sender_type").order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);

  const { data: outboundLogs } = await admin
    .from("communication_logs")
    .select("id, created_at, message_text, raw_payload")
    .eq("channel", "whatsapp")
    .eq("direction", "outbound")
    .gte("created_at", since7d)
    .order("created_at", { ascending: false })
    .limit(500);

  const outbound = outboundLogs ?? [];
  const sentLast24h = outbound.filter((r) => r.created_at >= since24h && logStatus(r) === "sent").length;
  const sentLast7d = outbound.filter((r) => logStatus(r) === "sent").length;
  const lastSent = outbound.find((r) => logStatus(r) === "sent") ?? null;
  const lastFailed = outbound.find((r) => logStatus(r) === "failed") ?? null;
  const recentFailed = outbound.filter((r) => logStatus(r) === "failed").slice(0, 20);

  const toPreview = (row: (typeof outbound)[number]) => {
    const p = (row.raw_payload ?? {}) as Record<string, unknown>;
    return {
      created_at: row.created_at,
      message_preview: String(row.message_text ?? "").slice(0, 120),
      template_key: (p.template_key as string | null) ?? null,
    };
  };
  const toFailed = (row: (typeof outbound)[number]) => {
    const p = (row.raw_payload ?? {}) as Record<string, unknown>;
    return {
      created_at: row.created_at,
      error: (p.error as string | null) ?? null,
      template_key: (p.template_key as string | null) ?? null,
    };
  };

  return {
    gateway_url_configured: !!(Deno.env.get("N8N_WHATSAPP_WEBHOOK_URL") ?? "").trim(),
    gateway_secret_configured: !!(Deno.env.get("N8N_WHATSAPP_WEBHOOK_SECRET") ?? "").trim(),
    inbox: {
      conversations: convAll.count ?? 0,
      messages: msgAll.count ?? 0,
      last_conversation_at: lastConv.data?.created_at ?? null,
      last_message_at: lastMsg.data?.created_at ?? null,
    },
    outbound_whatsapp: {
      sent_last_24h: sentLast24h,
      sent_last_7d: sentLast7d,
      last_sent: lastSent ? toPreview(lastSent) : null,
      last_failed: lastFailed ? toFailed(lastFailed) : null,
      recent_failed: recentFailed.map(toFailed),
    },
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (!(await isAdmin(req.headers.get("authorization")))) {
    return json({ ok: false, error: "forbidden" }, 403);
  }

  try {
    const result = await status();
    return json({ ok: true, ...result });
  } catch (e) {
    console.error("[whatsapp-diagnostics] error", e);
    return json({ ok: false, error: "server_error" }, 500);
  }
});
