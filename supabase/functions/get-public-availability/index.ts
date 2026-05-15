// Public availability endpoint — returns active slots with remaining capacity.
// Safe to call without auth; returns no PII.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isDate(v: string) { return /^\d{4}-\d{2}-\d{2}$/.test(v); }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  const url = new URL(req.url);
  const today = new Date().toISOString().slice(0, 10);
  let from = url.searchParams.get("from") ?? today;
  let to = url.searchParams.get("to") ?? "";

  if (!isDate(from)) from = today;
  if (!to || !isDate(to)) {
    // default 60 days out
    const d = new Date(); d.setUTCDate(d.getUTCDate() + 60);
    to = d.toISOString().slice(0, 10);
  }
  if (from < today) from = today;

  const { data: slots, error: slotErr } = await admin
    .from("availability_slots")
    .select("id,date,start_time,end_time,capacity")
    .eq("active", true)
    .gte("date", from)
    .lte("date", to)
    .order("date").order("start_time")
    .limit(1000);
  if (slotErr) return json({ ok: false, error: "server_error" }, 500);

  const { data: bookings, error: bkErr } = await admin
    .from("bookings")
    .select("scheduled_date,scheduled_time,booking_status")
    .gte("scheduled_date", from)
    .lte("scheduled_date", to)
    .neq("booking_status", "cancelled")
    .limit(5000);
  if (bkErr) return json({ ok: false, error: "server_error" }, 500);

  const counts = new Map<string, number>();
  for (const b of bookings ?? []) {
    const key = `${b.scheduled_date}|${String(b.scheduled_time).slice(0,8)}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const out = (slots ?? []).map((s: any) => {
    const key = `${s.date}|${String(s.start_time).slice(0,8)}`;
    const taken = counts.get(key) ?? 0;
    const remaining = Math.max(0, (s.capacity ?? 0) - taken);
    return {
      id: s.id,
      date: s.date,
      start_time: String(s.start_time).slice(0,5),
      end_time: String(s.end_time).slice(0,5),
      capacity: s.capacity,
      taken,
      remaining,
    };
  });

  return json({ ok: true, from, to, slots: out });
});
