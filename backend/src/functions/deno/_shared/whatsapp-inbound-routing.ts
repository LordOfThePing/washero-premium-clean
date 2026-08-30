// @ts-nocheck -- ported verbatim from functions/; not our source of truth for types
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeArgentinaWhatsAppPhone } from "./whatsapp-outbound.ts";

export type InboundRoutingType = "operational" | "commercial" | "supplier" | "unknown";

export type InboundRoutingResult = {
  routing_type: InboundRoutingType;
  routing_assigned_operator_id: string | null;
  routing_assigned_role: string | null;
  routing_requires_human: boolean;
  routing_reason: string;
  linked_booking_id: string | null;
};

const COMMERCIAL_KEYWORDS = [
  "precio",
  "sale",
  "costo",
  "servicio",
  "cobertura",
  "reserva",
  "suscripcion",
  "suscripción",
  "cotizar",
  "cuanto",
  "cuánto",
  "promo",
];

const SUPPLIER_KEYWORDS = [
  "proveedor",
  "insumos",
  "productos",
  "alianza",
  "propuesta",
  "concesionaria",
  "flota",
  "carone",
  "distribuidor",
  "mayorista",
];

const OPERATIONAL_KEYWORDS = [
  "llegar",
  "demora",
  "demorado",
  "puerta",
  "acceso",
  "domicilio",
  "ubicacion",
  "ubicación",
  "direccion",
  "dirección",
  "donde estan",
  "dónde están",
  "estan",
  "están",
  "esperando",
  "llegue",
  "llegué",
];

function todayBuenosAiresIso() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
}

function normalizeText(text: string) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

function matchesKeywords(text: string, keywords: string[]) {
  const n = normalizeText(text);
  return keywords.some((k) => n.includes(normalizeText(k)));
}

function phonesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizeArgentinaWhatsAppPhone(a);
  const nb = normalizeArgentinaWhatsAppPhone(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const tail = (digits: string) => digits.slice(-10);
  return tail(na) === tail(nb);
}

async function findTodayAssignedBooking(
  admin: SupabaseClient,
  phone: string | null,
): Promise<{
  id: string;
  assigned_operator_id: string;
  customer_name: string;
  scheduled_time: string;
} | null> {
  if (!phone) return null;
  const today = todayBuenosAiresIso();
  const { data: bookings, error } = await admin
    .from("bookings")
    .select("id,assigned_operator_id,customer_phone,customer_name,scheduled_time,booking_status")
    .eq("scheduled_date", today)
    .neq("booking_status", "cancelled")
    .not("assigned_operator_id", "is", null)
    .order("scheduled_time", { ascending: true })
    .limit(40);
  if (error) {
    console.warn("[whatsapp-inbound-routing] bookings lookup", error);
    return null;
  }
  for (const b of bookings ?? []) {
    if (phonesMatch(b.customer_phone, phone) && b.assigned_operator_id) {
      return {
        id: b.id,
        assigned_operator_id: b.assigned_operator_id,
        customer_name: String(b.customer_name ?? "Cliente"),
        scheduled_time: String(b.scheduled_time ?? ""),
      };
    }
  }
  return null;
}

export async function classifyInboundMessage(
  admin: SupabaseClient,
  input: { phone: string | null; messageText: string | null },
): Promise<InboundRoutingResult> {
  const text = String(input.messageText ?? "").trim();
  const todayBooking = await findTodayAssignedBooking(admin, input.phone);

  if (todayBooking) {
    return {
      routing_type: "operational",
      routing_assigned_operator_id: todayBooking.assigned_operator_id,
      routing_assigned_role: "operator",
      routing_requires_human: false,
      routing_reason: "today_assigned_booking",
      linked_booking_id: todayBooking.id,
    };
  }

  if (text && matchesKeywords(text, SUPPLIER_KEYWORDS)) {
    return {
      routing_type: "supplier",
      routing_assigned_operator_id: null,
      routing_assigned_role: "owner",
      routing_requires_human: true,
      routing_reason: "supplier_keywords",
      linked_booking_id: null,
    };
  }

  if (text && matchesKeywords(text, COMMERCIAL_KEYWORDS)) {
    return {
      routing_type: "commercial",
      routing_assigned_operator_id: null,
      routing_assigned_role: "admin",
      routing_requires_human: true,
      routing_reason: "commercial_keywords",
      linked_booking_id: null,
    };
  }

  if (text && matchesKeywords(text, OPERATIONAL_KEYWORDS)) {
    return {
      routing_type: "unknown",
      routing_assigned_operator_id: null,
      routing_assigned_role: "admin",
      routing_requires_human: true,
      routing_reason: "operational_keywords_no_today_booking",
      linked_booking_id: null,
    };
  }

  return {
    routing_type: "unknown",
    routing_assigned_operator_id: null,
    routing_assigned_role: "admin",
    routing_requires_human: true,
    routing_reason: "unclassified_inbound",
    linked_booking_id: null,
  };
}

export async function persistInboundRouting(
  admin: SupabaseClient,
  conversationId: string,
  routing: InboundRoutingResult,
  rawPayload: Record<string, unknown> | null,
): Promise<void> {
  const mergedRouting = {
    routing_type: routing.routing_type,
    routing_assigned_operator_id: routing.routing_assigned_operator_id,
    routing_assigned_role: routing.routing_assigned_role,
    routing_requires_human: routing.routing_requires_human,
    routing_reason: routing.routing_reason,
    linked_booking_id: routing.linked_booking_id,
    updated_at: new Date().toISOString(),
  };

  const update: Record<string, unknown> = {
    routing_type: routing.routing_type,
    routing_assigned_operator_id: routing.routing_assigned_operator_id,
    routing_assigned_role: routing.routing_assigned_role,
    routing_requires_human: routing.routing_requires_human,
    routing_reason: routing.routing_reason,
    raw_payload: {
      ...(rawPayload ?? {}),
      _routing: mergedRouting,
    },
  };

  if (routing.linked_booking_id) {
    update.linked_booking_id = routing.linked_booking_id;
  }

  const { error } = await admin
    .from("whatsapp_conversations")
    .update(update)
    .eq("id", conversationId);
  if (error) {
    console.warn("[whatsapp-inbound-routing] persist failed", error);
  }
}

export function operatorPushBody(
  customerName: string,
  scheduledTime: string,
): string {
  const time = scheduledTime.slice(0, 5);
  const name = customerName.trim() || "Cliente";
  return time ? `${name} · ${time} hs` : name;
}
