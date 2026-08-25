// Admin-triggered WhatsApp reminders for tomorrow's bookings.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  buildBookingReminderMessage,
  hasOutboundTemplateLogAny,
  sendTextViaTransport,
  type BookingNotifyRow,
} from "../_shared/whatsapp-automation.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

async function isActiveAdmin(authHeader: string | null): Promise<boolean> {
  if (!authHeader) return false;
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data } = await userClient.auth.getUser();
  if (!data.user) return false;
  const { data: row } = await admin
    .from("admin_users")
    .select("active, role")
    .eq("user_id", data.user.id)
    .maybeSingle();
  return !!row?.active && ["owner", "admin"].includes(row.role ?? "");
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function tomorrowIsoBuenosAires(): string {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const today = fmt.format(now);
  const [y, m, d] = today.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + 1);
  return dt.toISOString().slice(0, 10);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  if (!(await isActiveAdmin(req.headers.get("authorization")))) {
    return json({ ok: false, error: "forbidden" }, 403);
  }

  const targetDate = tomorrowIsoBuenosAires();
  const sinceIso = `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`;

  const { data: bookings, error } = await admin
    .from("bookings")
    .select(
      "id, customer_name, customer_phone, service_name, scheduled_date, scheduled_time, address, formatted_address, booking_status, payment_status, payment_method, price, booking_source",
    )
    .eq("scheduled_date", targetDate)
    .in("booking_status", ["pending", "confirmed", "needs_review"]);

  if (error) {
    console.error("[send-booking-reminders]", error);
    return json({ ok: false, error: "fetch_failed" }, 500);
  }

  let sent = 0;
  let skipped = 0;
  let failed = 0;
  const candidates = (bookings ?? []) as BookingNotifyRow[];

  for (const b of candidates) {
    if (!b.customer_phone?.trim()) {
      skipped++;
      continue;
    }
    if (await hasOutboundTemplateLogAny(admin, b.id, "booking_reminder_tomorrow", sinceIso)) {
      skipped++;
      continue;
    }

    const result = await sendTextViaTransport(admin, {
      phone: b.customer_phone,
      message: buildBookingReminderMessage(b),
      bookingId: b.id,
      templateKey: "booking_reminder_tomorrow",
      customerName: b.customer_name,
    });

    if (result.ok) sent++;
    else if (result.status === "skipped") skipped++;
    else failed++;
  }

  return json({
    ok: true,
    target_date: targetDate,
    total_candidates: candidates.length,
    sent,
    skipped,
    failed,
    token_configured: !!(Deno.env.get("BOTMAKER_API_TOKEN") ?? ""),
  });
});
