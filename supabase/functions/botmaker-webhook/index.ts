// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { tryCreateBooking } from "../_shared/booking-core.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, auth-bm-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("BOTMAKER_WEBHOOK_SECRET") ?? "";

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false },
});

function pick(obj: any, paths: string[]): string | null {
  for (const p of paths) {
    const parts = p.split(".");
    let cur: any = obj;
    let ok = true;
    for (const k of parts) {
      if (cur == null) { ok = false; break; }
      cur = cur[k];
    }
    if (ok && cur != null && cur !== "") {
      if (typeof cur === "string" || typeof cur === "number") return String(cur);
    }
  }
  return null;
}

function extractConversationId(p: any): string | null {
  return pick(p, [
    "customerId","chatId","chat.id","conversationId","conversation.id",
    "sessionId","userId","contactId",
  ]);
}
function extractPhone(p: any): string | null {
  const v = pick(p, [
    "realWhatsAppId","whatsappId","customer.phone","contact.phone",
    "user.phone","from","sender","phone",
  ]);
  return v ? v.replace(/[^\d+]/g, "") : null;
}
function extractName(p: any): string | null {
  return pick(p, ["fullName","customer.name","contact.name","user.name","name"]);
}
function extractMessageText(p: any): string | null {
  let v = pick(p, [
    "message","text","message.text","content","content.text","body",
    "data.text","data.message","event.message","event.text",
  ]);
  if (!v && Array.isArray(p?.messages) && p.messages[0]) {
    v = p.messages[0].text ?? p.messages[0].message ?? null;
  }
  return v;
}
function extractChannel(p: any, phone: string | null): string {
  const v = pick(p, ["channel","chatPlatform","platform"]);
  if (v) return v;
  if (phone) return "whatsapp";
  return "webchat";
}
function extractSenderType(p: any): string {
  const raw = (pick(p, ["senderType","sender_type","from_type","author.type","sender.type"]) || "").toLowerCase();
  if (raw.includes("bot")) return "bot";
  if (raw.includes("agent") || raw.includes("operator") || raw.includes("human")) return "agent";
  if (raw.includes("user") || raw.includes("customer") || raw.includes("client")) return "user";
  if (raw.includes("system") || raw.includes("event")) return "system";
  // heuristics
  if (p?.fromBot === true || p?.from_bot === true) return "bot";
  if (p?.fromAgent === true) return "agent";
  return "user";
}
function extractEventType(p: any): string {
  return pick(p, ["eventType","event_type","type","event"]) || "message";
}

// ---- Booking summary detection / parsing ----
const SUMMARY_MARKERS = [
  "tengo estos datos",
  "nombre completo:",
  "¿confirmás que está todo bien?",
];
const CONFIRM_WORDS = [
  "si","sí","sisi","confirmo","correcto","ok","dale","joya","perfecto","confirmado","está bien","esta bien",
];

function isSummary(text: string): boolean {
  const t = text.toLowerCase();
  let hits = 0;
  for (const m of SUMMARY_MARKERS) if (t.includes(m)) hits++;
  // Also count typical fields
  if (t.includes("dirección:") || t.includes("direccion:")) hits++;
  if (t.includes("zona:")) hits++;
  if (t.includes("vehículo:") || t.includes("vehiculo:")) hits++;
  if (t.includes("servicio:")) hits++;
  if (t.includes("día:") || t.includes("dia:")) hits++;
  if (t.includes("horario:")) hits++;
  return hits >= 3;
}
function isConfirmation(text: string): boolean {
  const t = text.trim().toLowerCase().replace(/[!.¡¿?]/g, "");
  if (!t) return false;
  if (t.length > 30) return false;
  return CONFIRM_WORDS.some((w) => t === w || t.startsWith(w + " ") || t.endsWith(" " + w));
}

function getField(text: string, label: string): string | null {
  const re = new RegExp(label + "\\s*:\\s*([^\\n\\r]+)", "i");
  const m = text.match(re);
  return m ? m[1].trim() : null;
}

function normalizeService(v: string | null): string | null {
  if (!v) return null;
  const t = v.toLowerCase();
  if (t.includes("complet")) return "Lavado Completo";
  if (t.includes("básic") || t.includes("basic")) return "Lavado Básico";
  return v.trim();
}
function normalizeVehicle(v: string | null): string | null {
  if (!v) return null;
  const t = v.toLowerCase();
  if (t.includes("suv")) return "SUV";
  if (t.includes("pick") || t.includes("camioneta")) return "Pick-up";
  if (t.includes("auto")) return "Auto";
  return v.trim();
}
function normalizePayment(v: string | null): string | null {
  if (!v) return null;
  const t = v.toLowerCase();
  if (t.includes("mercado")) return "MercadoPago";
  if (t.includes("transfer")) return "Transferencia";
  if (t.includes("despu") || t.includes("efect")) return "Pagar después";
  return v.trim();
}
function normalizeTime(v: string | null): string | null {
  if (!v) return null;
  const t = v.toLowerCase().replace(/\s+/g, "");
  let m = t.match(/(\d{1,2})[:hs.](\d{0,2})/);
  if (m) {
    const h = parseInt(m[1], 10);
    const mm = m[2] ? parseInt(m[2], 10) : 0;
    return `${String(h).padStart(2,"0")}:${String(mm).padStart(2,"0")}`;
  }
  m = t.match(/(\d{1,2})(am|pm)/);
  if (m) {
    let h = parseInt(m[1], 10);
    if (m[2] === "pm" && h < 12) h += 12;
    if (m[2] === "am" && h === 12) h = 0;
    return `${String(h).padStart(2,"0")}:00`;
  }
  m = t.match(/alas(\d{1,2})/);
  if (m) return `${String(parseInt(m[1],10)).padStart(2,"0")}:00`;
  return null;
}
function normalizeDate(v: string | null): string | null {
  if (!v) return null;
  // Compute "today" in Argentina
  const now = new Date();
  const ar = new Date(now.getTime() - 3 * 60 * 60 * 1000); // UTC-3
  const t = v.toLowerCase().trim();
  const days = ["domingo","lunes","martes","miércoles","miercoles","jueves","viernes","sábado","sabado"];
  const dayMap: Record<string, number> = {
    domingo:0, lunes:1, martes:2, miércoles:3, miercoles:3, jueves:4, viernes:5, sábado:6, sabado:6,
  };
  const d = new Date(ar);
  if (t.includes("pasado mañana") || t.includes("pasado manana")) {
    d.setDate(d.getDate() + 2);
  } else if (t.includes("mañana") || t.includes("manana")) {
    d.setDate(d.getDate() + 1);
  } else if (t.includes("hoy")) {
    // today
  } else {
    let matched = false;
    for (const name of days) {
      if (t.includes(name)) {
        const target = dayMap[name];
        const cur = d.getDay();
        let diff = (target - cur + 7) % 7;
        if (diff === 0 || t.includes("que viene") || t.includes("próxim") || t.includes("proxim")) {
          diff = diff === 0 ? 7 : diff;
          if (t.includes("que viene") || t.includes("próxim") || t.includes("proxim")) diff = ((target - cur + 7) % 7) || 7;
        }
        d.setDate(d.getDate() + diff);
        matched = true;
        break;
      }
    }
    // ISO date pattern dd/mm or yyyy-mm-dd
    const iso = t.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return iso[0];
    const dm = t.match(/(\d{1,2})\/(\d{1,2})/);
    if (dm) {
      const dd = String(parseInt(dm[1],10)).padStart(2,"0");
      const mm = String(parseInt(dm[2],10)).padStart(2,"0");
      return `${d.getFullYear()}-${mm}-${dd}`;
    }
    if (!matched) return null;
  }
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth()+1).padStart(2,"0");
  const dd = String(d.getDate()).padStart(2,"0");
  return `${yyyy}-${mm}-${dd}`;
}

function parseSummary(text: string) {
  const customer_name = getField(text, "Nombre completo") ?? getField(text, "Nombre");
  const address = getField(text, "Dirección") ?? getField(text, "Direccion");
  const neighborhood = getField(text, "Zona");
  const vehicle_type = normalizeVehicle(getField(text, "Vehículo") ?? getField(text, "Vehiculo"));
  const service_type = normalizeService(getField(text, "Servicio"));
  const preferred_date = normalizeDate(getField(text, "Día") ?? getField(text, "Dia"));
  const preferred_time = normalizeTime(getField(text, "Horario"));
  const payment_method = normalizePayment(getField(text, "Pago"));
  const fields = { customer_name, address, neighborhood, vehicle_type, service_type, preferred_date, preferred_time, payment_method };
  const missing = Object.entries(fields).filter(([,v]) => !v).map(([k]) => k);
  return { fields, missing };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  let payload: any = {};
  let raw = "";
  try {
    raw = await req.text();
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    payload = { _parse_error: true, _raw: raw };
  }

  const token = req.headers.get("auth-bm-token") ?? "";
  const authValid = !!WEBHOOK_SECRET && token === WEBHOOK_SECRET;

  const conversationId = extractConversationId(payload);
  const phone = extractPhone(payload);
  const name = extractName(payload);
  const messageText = extractMessageText(payload);
  const channel = extractChannel(payload, phone);
  const senderType = extractSenderType(payload);
  const eventType = extractEventType(payload);

  // Always log event
  await supabase.from("botmaker_events").insert({
    event_type: eventType,
    channel,
    sender_type: senderType,
    conversation_id: conversationId,
    customer_phone: phone,
    customer_name: name,
    message_text: messageText,
    auth_valid: authValid,
    raw_payload: payload,
  });

  if (!authValid) {
    return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    // Upsert conversation
    let convoRow: any = null;
    if (conversationId) {
      const { data: existing } = await supabase
        .from("botmaker_conversations")
        .select("*")
        .eq("botmaker_conversation_id", conversationId)
        .maybeSingle();

      if (existing) {
        const { data: updated } = await supabase
          .from("botmaker_conversations")
          .update({
            customer_phone: phone ?? existing.customer_phone,
            customer_name: name ?? existing.customer_name,
            channel: channel ?? existing.channel,
            last_message: messageText ?? existing.last_message,
            last_message_at: messageText ? new Date().toISOString() : existing.last_message_at,
            last_sender_type: messageText ? senderType : existing.last_sender_type,
            raw_payload: payload,
          })
          .eq("id", existing.id)
          .select()
          .maybeSingle();
        convoRow = updated;
      } else {
        const { data: created } = await supabase
          .from("botmaker_conversations")
          .insert({
            botmaker_conversation_id: conversationId,
            customer_phone: phone,
            customer_name: name,
            channel,
            last_message: messageText,
            last_message_at: messageText ? new Date().toISOString() : null,
            last_sender_type: messageText ? senderType : null,
            raw_payload: payload,
          })
          .select()
          .maybeSingle();
        convoRow = created;
      }
    }

    // Insert message
    if (convoRow && messageText) {
      await supabase.from("botmaker_messages").insert({
        conversation_id: convoRow.id,
        botmaker_message_id: pick(payload, ["messageId","message.id","id"]),
        direction: senderType === "user" ? "inbound" : "outbound",
        sender_type: senderType,
        message_type: "text",
        message_text: messageText,
        customer_phone: phone,
        customer_name: name,
        channel,
        raw_payload: payload,
      });
    }

    // Customer sync by phone
    if (convoRow && phone) {
      const { data: cust } = await supabase
        .from("customers")
        .select("id")
        .eq("phone", phone)
        .maybeSingle();
      if (cust?.id) {
        if (!convoRow.linked_customer_id || convoRow.linked_customer_id !== cust.id) {
          await supabase.from("botmaker_conversations")
            .update({ linked_customer_id: cust.id })
            .eq("id", convoRow.id);
        }
      } else if (name) {
        const { data: newCust } = await supabase.from("customers").insert({
          full_name: name, phone,
        }).select("id").maybeSingle();
        if (newCust?.id) {
          await supabase.from("botmaker_conversations")
            .update({ linked_customer_id: newCust.id })
            .eq("id", convoRow.id);
        }
      }
    }

    // Booking request detection
    if (convoRow && messageText) {
      if (senderType === "bot" && isSummary(messageText)) {
        // Just a summary; nothing to do — confirmation comes later
      } else if (senderType === "user" && isConfirmation(messageText)) {
        // Find latest bot summary in last 30 min in same conversation
        const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
        const { data: msgs } = await supabase
          .from("botmaker_messages")
          .select("*")
          .eq("conversation_id", convoRow.id)
          .eq("sender_type", "bot")
          .gte("created_at", cutoff)
          .order("created_at", { ascending: false })
          .limit(10);
        const summary = (msgs ?? []).find((m: any) => m.message_text && isSummary(m.message_text));
        if (summary) {
          // Dedup: skip if there is a botmaker booking_request for same conversation in last 10 min
          const dedupCutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
          const { data: recent } = await supabase
            .from("booking_requests")
            .select("id, created_at, raw_payload")
            .eq("source", "botmaker")
            .gte("created_at", dedupCutoff)
            .order("created_at", { ascending: false })
            .limit(20);
          const dup = (recent ?? []).find((r: any) =>
            r.raw_payload?.conversation_id === convoRow.botmaker_conversation_id &&
            r.raw_payload?.summary_text === summary.message_text
          );
          if (!dup) {
            const parsed = parseSummary(summary.message_text);
            const { data: br } = await supabase.from("booking_requests").insert({
              source: "botmaker",
              status: "needs_review",
              customer_name: parsed.fields.customer_name,
              customer_phone: phone ?? convoRow.customer_phone,
              address: parsed.fields.address,
              neighborhood: parsed.fields.neighborhood,
              vehicle_type: parsed.fields.vehicle_type,
              service_type: parsed.fields.service_type,
              preferred_date: parsed.fields.preferred_date,
              preferred_time: parsed.fields.preferred_time,
              payment_method: parsed.fields.payment_method,
              missing_fields: parsed.missing,
              is_test: !!payload?.is_test,
              raw_payload: {
                conversation_id: convoRow.botmaker_conversation_id,
                summary_text: summary.message_text,
                confirmation_text: messageText,
                parsed: parsed.fields,
                missing_fields: parsed.missing,
                bot_payload: summary.raw_payload,
                user_payload: payload,
                is_test: !!payload?.is_test,
              },
            }).select("id").maybeSingle();
            if (br?.id) {
              await supabase.from("botmaker_conversations")
                .update({ linked_booking_request_id: br.id })
                .eq("id", convoRow.id);
              await supabase.from("communication_logs").insert({
                channel: "whatsapp",
                provider: "botmaker",
                direction: "system",
                message_text: "booking_request creado desde Botmaker",
                booking_request_id: br.id,
                raw_payload: { conversation_id: convoRow.botmaker_conversation_id },
              });
            }
          }
        }
      }
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("botmaker-webhook error", e);
    return new Response(JSON.stringify({ ok: false, error: String(e?.message ?? e) }), {
      status: 200, // ack to avoid Botmaker retries flooding; we logged the event
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
