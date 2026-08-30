// @ts-nocheck -- ported verbatim from supabase/functions; not our source of truth for types
// Bridge between an external WhatsApp AI agent and the Washero database.
// Auth: send header `x-washi-agent-secret` matching env `WASHI_AGENT_SECRET`.
// Configure with: supabase secrets set WASHI_AGENT_SECRET="valor-seguro"
import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-washi-agent-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const WASHI_AGENT_SECRET = process.env.WASHI_AGENT_SECRET ?? "";
const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

type Payload = {
  action?: string;
  phone?: string;
};

type CustomerRow = {
  id: string;
  full_name: string | null;
  phone: string | null;
};

type BookingRow = {
  id: string;
  customer_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  vehicle_type: string | null;
  address: string | null;
  neighborhood: string | null;
  service_name: string | null;
  scheduled_date: string | null;
  scheduled_time: string | null;
  created_at: string;
};

const BOOKING_SELECT =
  "id, customer_id, customer_name, customer_phone, vehicle_type, address, neighborhood, service_name, scheduled_date, scheduled_time, created_at";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isAuthorized(req: Request): boolean {
  const provided = req.headers.get("x-washi-agent-secret") ?? "";
  return !!WASHI_AGENT_SECRET && provided === WASHI_AGENT_SECRET;
}

function normalizePhoneDigits(raw: string | null | undefined): string {
  return String(raw ?? "").replace(/\D/g, "");
}

function formatTime(value: string | null): string | null {
  if (!value) return null;
  return String(value).slice(0, 5);
}

function formatLastBooking(row: BookingRow | null) {
  if (!row) return null;
  return {
    id: row.id,
    vehicle_type: row.vehicle_type,
    address: row.address,
    neighborhood: row.neighborhood,
    service_name: row.service_name,
    scheduled_date: row.scheduled_date,
    scheduled_time: formatTime(row.scheduled_time),
  };
}

function formatCustomer(row: CustomerRow | null, fallbackPhone: string) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.full_name,
    phone: normalizePhoneDigits(row.phone) || fallbackPhone,
  };
}

function customerFromBooking(row: BookingRow, fallbackPhone: string) {
  return {
    id: row.customer_id,
    name: row.customer_name,
    phone: normalizePhoneDigits(row.customer_phone) || fallbackPhone,
  };
}

async function findCustomerByPhone(digits: string): Promise<CustomerRow | null> {
  const { data: exact } = await admin
    .from("customers")
    .select("id, full_name, phone")
    .eq("phone", digits)
    .maybeSingle();
  if (exact) return exact;

  const tail = digits.length >= 10 ? digits.slice(-10) : digits;
  const { data: candidates, error } = await admin
    .from("customers")
    .select("id, full_name, phone")
    .like("phone", `%${tail}%`)
    .limit(25);
  if (error) throw error;

  return candidates?.find((c) => normalizePhoneDigits(c.phone) === digits) ?? null;
}

async function getLastBookingByPhone(digits: string): Promise<BookingRow | null> {
  const tail = digits.length >= 10 ? digits.slice(-10) : digits;
  const { data: rows, error } = await admin
    .from("bookings")
    .select(BOOKING_SELECT)
    .like("customer_phone", `%${tail}%`)
    .order("scheduled_date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(25);
  if (error) throw error;

  return rows?.find((b) => normalizePhoneDigits(b.customer_phone) === digits) ?? null;
}

async function getLastBookingForCustomer(
  customerId: string,
  phoneDigits: string,
): Promise<BookingRow | null> {
  const { data: byCustomer, error: byCustomerErr } = await admin
    .from("bookings")
    .select(BOOKING_SELECT)
    .eq("customer_id", customerId)
    .order("scheduled_date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (byCustomerErr) throw byCustomerErr;
  if (byCustomer) return byCustomer;

  return getLastBookingByPhone(phoneDigits);
}

async function lookupCustomer(phoneRaw: string) {
  const phoneDigits = normalizePhoneDigits(phoneRaw);
  if (!phoneDigits) {
    return json({
      ok: true,
      customer_exists: false,
      customer: null,
      last_booking: null,
    });
  }

  const customer = await findCustomerByPhone(phoneDigits);
  let lastBooking: BookingRow | null = null;

  if (customer) {
    lastBooking = await getLastBookingForCustomer(customer.id, phoneDigits);
    return json({
      ok: true,
      customer_exists: true,
      customer: formatCustomer(customer, phoneDigits),
      last_booking: formatLastBooking(lastBooking),
    });
  }

  lastBooking = await getLastBookingByPhone(phoneDigits);
  if (!lastBooking) {
    return json({
      ok: true,
      customer_exists: false,
      customer: null,
      last_booking: null,
    });
  }

  return json({
    ok: true,
    customer_exists: true,
    customer: customerFromBooking(lastBooking, phoneDigits),
    last_booking: formatLastBooking(lastBooking),
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  if (!isAuthorized(req)) {
    return json({ ok: false, error: "Unauthorized" }, 401);
  }

  let body: Payload;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  const action = (body.action ?? "").trim();
  if (action !== "lookup_customer") {
    return json({ ok: false, error: "unknown_action" }, 400);
  }

  const phone = (body.phone ?? "").trim();
  if (!phone) {
    return json({ ok: false, error: "missing_phone" }, 400);
  }

  try {
    return await lookupCustomer(phone);
  } catch (e: unknown) {
    console.error("washi-agent lookup_customer error", e);
    return json({ ok: false, error: "server_error" }, 500);
  }
});
