import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  extractChannel,
  extractConversationId,
  extractEventType,
  extractMessageText,
  extractName,
  extractPhone,
  extractSenderType,
  findLatestSummary,
  isConfirmation,
  pick,
  processBotmakerBookingImpact,
} from "../_shared/botmaker-booking.ts";
import {
  classifyInboundMessage,
  operatorPushBody,
  persistInboundRouting,
} from "../_shared/botmaker-inbound-routing.ts";
import {
  capturePaymentReceiptFromBotmaker,
  extractInboundReceiptMedia,
} from "../_shared/payment-receipts.ts";
import { normalizeArgentinaWhatsAppPhone } from "../_shared/botmaker-outbound.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, auth-bm-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("BOTMAKER_WEBHOOK_SECRET") ?? "";
const PUSH_INTERNAL_SECRET = Deno.env.get("PUSH_INTERNAL_SECRET") ?? "";

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false },
});

async function notifyOperatorPush(
  bookingId: string,
  opts: { title?: string; body?: string },
) {
  if (!PUSH_INTERNAL_SECRET) return;
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/send-operator-push`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-secret": PUSH_INTERNAL_SECRET,
      },
      body: JSON.stringify({
        booking_id: bookingId,
        reason: "new_message_today",
        force: true,
        title: opts.title ?? "Mensaje nuevo de cliente",
        body: opts.body ?? "Tenés un nuevo mensaje operativo.",
      }),
    });
  } catch (e) {
    console.warn("[botmaker-webhook] send-operator-push", String(e));
  }
}

function inboundPreviewText(messageText: string | null, hasReceiptMedia: boolean): string | null {
  if (messageText?.trim()) return messageText.trim();
  if (hasReceiptMedia) return "[Comprobante de pago]";
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  let payload: Record<string, unknown> = {};
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
  const inboundMedia = extractInboundReceiptMedia(payload);
  const channel = extractChannel(payload, phone);
  const senderType = extractSenderType(payload);
  const eventType = extractEventType(payload);
  const previewText = inboundPreviewText(messageText, !!inboundMedia);

  await supabase.from("botmaker_events").insert({
    event_type: eventType,
    channel,
    sender_type: senderType,
    conversation_id: conversationId,
    customer_phone: phone,
    customer_name: name,
    message_text: previewText,
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
    let convoRow: Record<string, unknown> | null = null;
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
            last_message: previewText ?? existing.last_message,
            last_message_at: previewText ? new Date().toISOString() : existing.last_message_at,
            last_sender_type: previewText ? senderType : existing.last_sender_type,
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
            last_message: previewText,
            last_message_at: previewText ? new Date().toISOString() : null,
            last_sender_type: previewText ? senderType : null,
            raw_payload: payload,
          })
          .select()
          .maybeSingle();
        convoRow = created;
      }
    }

    if (convoRow && (messageText || inboundMedia)) {
      const messageType = inboundMedia?.messageType ?? "text";
      const { data: msgRow } = await supabase.from("botmaker_messages").insert({
        conversation_id: convoRow.id,
        botmaker_message_id: pick(payload, ["messageId", "message.id", "id"]),
        direction: senderType === "user" ? "inbound" : "outbound",
        sender_type: senderType,
        message_type: messageType,
        message_text: messageText ?? inboundMedia?.caption ?? previewText,
        customer_phone: phone,
        customer_name: name,
        channel,
        raw_payload: payload,
      }).select("id").maybeSingle();

      if (senderType === "user" && inboundMedia) {
        try {
          await capturePaymentReceiptFromBotmaker(supabase, {
            phone,
            customerPhoneNormalized: normalizeArgentinaWhatsAppPhone(phone),
            botmakerMessageId: msgRow?.id ?? null,
            media: inboundMedia,
            rawPayload: payload,
          });
        } catch (e) {
          console.error("[botmaker-webhook] payment receipt capture failed", e);
        }
      }

      if (senderType === "user" && messageText) {
        const routing = await classifyInboundMessage(supabase, { phone, messageText });
        await persistInboundRouting(
          supabase,
          String(convoRow.id),
          routing,
          payload,
        );

        if (
          routing.routing_type === "operational" &&
          routing.linked_booking_id &&
          routing.routing_assigned_operator_id
        ) {
          const { data: booking } = await supabase
            .from("bookings")
            .select("customer_name,scheduled_time")
            .eq("id", routing.linked_booking_id)
            .maybeSingle();
          await notifyOperatorPush(routing.linked_booking_id, {
            title: "Mensaje nuevo de cliente",
            body: operatorPushBody(
              String(booking?.customer_name ?? name ?? "Cliente"),
              String(booking?.scheduled_time ?? ""),
            ),
          });
        }
      }
    }

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
          full_name: name,
          phone,
        }).select("id").maybeSingle();
        if (newCust?.id) {
          await supabase.from("botmaker_conversations")
            .update({ linked_customer_id: newCust.id })
            .eq("id", convoRow.id);
        }
      }
    }

    if (convoRow && messageText && isConfirmation(messageText)) {
      const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      const { data: msgs } = await supabase
        .from("botmaker_messages")
        .select("*")
        .eq("conversation_id", convoRow.id)
        .gte("created_at", cutoff)
        .order("created_at", { ascending: true })
        .limit(100);
      const summary = findLatestSummary(msgs ?? []);
      if (summary) {
        await processBotmakerBookingImpact(supabase, {
          conversation: convoRow,
          summary,
          confirmation: {
            sender_type: senderType,
            message_text: messageText,
            created_at: new Date().toISOString(),
            raw_payload: payload,
          },
          phone,
          isTest: !!payload?.is_test,
          currentPayload: payload,
          messages: msgs ?? [],
        });
      }
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: unknown) {
    console.error("botmaker-webhook error", e);
    return new Response(JSON.stringify({ ok: false, error: String((e as Error)?.message ?? e) }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
