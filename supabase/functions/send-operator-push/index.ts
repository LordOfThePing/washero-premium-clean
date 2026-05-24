import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import webpush from "npm:web-push@3.6.7";
import { getOperatorGate } from "../_shared/operator-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
const PUSH_INTERNAL_SECRET = Deno.env.get("PUSH_INTERNAL_SECRET") ?? "";
const VAPID_PUBLIC_KEY = Deno.env.get("WEB_PUSH_VAPID_PUBLIC_KEY") ?? "";
const VAPID_PRIVATE_KEY = Deno.env.get("WEB_PUSH_VAPID_PRIVATE_KEY") ?? "";
const VAPID_SUBJECT = Deno.env.get("WEB_PUSH_VAPID_SUBJECT") ?? "mailto:ops@washero.ar";

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

type Payload = {
  test?: boolean;
  booking_id?: string;
  reason?: "booking_assigned_today" | "booking_updated_today" | "new_message_today" | "test";
  title?: string;
  body?: string;
  url?: string;
  force?: boolean;
};

type SubscriptionRow = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function fallbackTitle(reason: string | undefined) {
  if (reason === "new_message_today") return "Mensaje nuevo de cliente";
  if (reason === "booking_updated_today") return "Reserva actualizada";
  if (reason === "test") return "Washero";
  return "Nueva reserva para hoy";
}

function fallbackBody(reason: string | undefined) {
  if (reason === "new_message_today") return "Tenés un nuevo mensaje operativo.";
  if (reason === "booking_updated_today") return "Cambió una reserva asignada para hoy.";
  if (reason === "test") return "Notificaciones activadas correctamente.";
  return "Te asignaron una reserva para hoy.";
}

function pushStatusCode(error: unknown): number | null {
  if (error && typeof error === "object" && "statusCode" in error) {
    const code = (error as { statusCode?: number }).statusCode;
    return typeof code === "number" ? code : null;
  }
  return null;
}

async function sendToSubscriptions(
  subs: SubscriptionRow[],
  payload: string,
): Promise<{ sent: number; removed: number }> {
  let sent = 0;
  let removed = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification(
        {
          endpoint: s.endpoint,
          keys: { p256dh: s.p256dh, auth: s.auth },
        },
        payload,
      );
      sent += 1;
    } catch (e) {
      const status = pushStatusCode(e);
      console.warn("[send-operator-push] failed subscription", s.id, status, String(e));
      if (status === 404 || status === 410) {
        const { error: delErr } = await admin.from("notification_subscriptions").delete().eq("id", s.id);
        if (!delErr) removed += 1;
      }
    }
  }
  return { sent, removed };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, status: "method_not_allowed" }, 405);

  const internalSecret = req.headers.get("x-internal-secret") ?? "";
  const internalAllowed = !!PUSH_INTERNAL_SECRET && internalSecret === PUSH_INTERNAL_SECRET;

  let body: Payload;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, status: "invalid_json" }, 400);
  }

  const isTest = body.test === true;

  if (!internalAllowed && isTest) {
    const gate = await getOperatorGate({
      authHeader: req.headers.get("authorization"),
      supabaseUrl: SUPABASE_URL,
      anonKey: ANON_KEY,
      admin,
    });
    if (!gate.ok || !gate.userId) {
      return json({ ok: false, status: "forbidden" }, 403);
    }
  } else if (!internalAllowed && !isTest) {
    const gate = await getOperatorGate({
      authHeader: req.headers.get("authorization"),
      supabaseUrl: SUPABASE_URL,
      anonKey: ANON_KEY,
      admin,
    });
    if (!gate.ok || !["owner", "admin"].includes(gate.role ?? "")) {
      return json({ ok: false, status: "forbidden" }, 403);
    }
  }

  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    return json({ ok: false, status: "missing_vapid_keys" }, 500);
  }
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

  if (isTest) {
    let userId: string | null = null;
    if (internalAllowed) {
      return json({ ok: false, status: "test_requires_user_auth" }, 400);
    }
    const gate = await getOperatorGate({
      authHeader: req.headers.get("authorization"),
      supabaseUrl: SUPABASE_URL,
      anonKey: ANON_KEY,
      admin,
    });
    if (!gate.ok || !gate.userId) {
      return json({ ok: false, status: "forbidden" }, 403);
    }
    userId = gate.userId;

    const { data: subs } = await admin
      .from("notification_subscriptions")
      .select("id,endpoint,p256dh,auth")
      .eq("user_id", userId);
    if (!subs || subs.length === 0) {
      return json({ ok: true, skipped: "no_subscriptions", sent: 0, removed: 0 });
    }

    const payload = JSON.stringify({
      title: body.title ?? "Washero",
      body: body.body ?? "Notificaciones activadas correctamente.",
      url: body.url ?? "/operator/hoy",
      reason: "test",
    });

    const { sent, removed } = await sendToSubscriptions(subs as SubscriptionRow[], payload);
    return json({ ok: true, sent, removed });
  }

  const bookingId = String(body.booking_id ?? "").trim();
  if (!bookingId) return json({ ok: false, status: "missing_booking_id" }, 400);

  const { data: booking } = await admin
    .from("bookings")
    .select("id,assigned_operator_id,scheduled_date,scheduled_time")
    .eq("id", bookingId)
    .maybeSingle();
  if (!booking) return json({ ok: false, status: "booking_not_found" }, 404);

  const today = new Date().toISOString().slice(0, 10);
  if (!body.force && booking.scheduled_date !== today) {
    return json({ ok: true, skipped: "not_today", sent: 0 });
  }
  if (!booking.assigned_operator_id) {
    return json({ ok: true, skipped: "no_assigned_operator", sent: 0 });
  }

  const { data: staff } = await admin
    .from("admin_users")
    .select("id,user_id,active")
    .eq("id", booking.assigned_operator_id)
    .maybeSingle();
  if (!staff?.active || !staff.user_id) {
    return json({ ok: true, skipped: "operator_inactive", sent: 0 });
  }

  const { data: subs } = await admin
    .from("notification_subscriptions")
    .select("id,endpoint,p256dh,auth")
    .eq("user_id", staff.user_id);
  if (!subs || subs.length === 0) {
    return json({ ok: true, skipped: "no_subscriptions", sent: 0 });
  }

  const payload = JSON.stringify({
    title: body.title ?? fallbackTitle(body.reason),
    body: body.body ?? fallbackBody(body.reason),
    url: body.url ?? `/operator/reserva/${booking.id}`,
    booking_id: booking.id,
    reason: body.reason ?? "booking_assigned_today",
  });

  const { sent, removed } = await sendToSubscriptions(subs as SubscriptionRow[], payload);
  return json({ ok: true, sent, removed });
});
