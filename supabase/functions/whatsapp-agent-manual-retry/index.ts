// Secure server-side endpoint for manually retrying an AMBIGUOUS outbound delivery (production-
// hardening audit — "ambiguous delivery review and manual retry"). The frontend must never call
// Botmaker directly and must never silently flip an outbound row's status — this function is the
// only path allowed to do either. Core retry logic lives in
// _shared/whatsapp-agent/manual-retry.ts (testable without a live HTTP server); this file only
// adds JWT/admin authentication and HTTP plumbing around it.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { retryAmbiguousDelivery } from "../_shared/whatsapp-agent/manual-retry.ts";
import { requireActiveAdmin } from "../_shared/whatsapp-agent/admin-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type Payload = { outbound_message_id?: string; reason?: string };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const identity = await requireActiveAdmin(admin, {
    supabaseUrl: SUPABASE_URL,
    anonKey: ANON_KEY,
    authHeader: req.headers.get("Authorization"),
  });
  if (!identity) return json({ ok: false, error: "Unauthorized" }, 401);

  let body: Payload;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  const outboundMessageId = (body.outbound_message_id ?? "").trim();
  if (!outboundMessageId) return json({ ok: false, error: "missing_outbound_message_id" }, 400);
  const reason = (body.reason ?? "manual_admin_retry").trim().slice(0, 500);

  try {
    const result = await retryAmbiguousDelivery(admin, {
      outboundMessageId,
      adminId: identity.adminId,
      reason,
    });
    if (!result.ok) {
      const statusCode =
        result.error === "not_found" || result.error === "conversation_not_found"
          ? 404
          : result.error === "not_ambiguous"
            ? 409
            : result.error === "retry_already_in_progress"
              ? 429
              : 500;
      return json(
        { ok: false, error: result.error, current_status: result.currentStatus },
        statusCode,
      );
    }
    return json({
      ok: true,
      retry_id: result.retryId,
      outcome: result.outcome,
      status: result.status,
    });
  } catch (e) {
    // Never return raw internal errors/secrets to the client.
    console.error("[whatsapp-agent-manual-retry] unexpected error", e);
    return json({ ok: false, error: "server_error" }, 500);
  }
});
