// @ts-nocheck -- ported verbatim from functions/; not our source of truth for types
// Supabase Edge Function: mp-diagnostics
// Returns Mercado Pago configuration status without exposing token values.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const mpToken = process.env.MERCADOPAGO_ACCESS_TOKEN ?? "";
  const siteUrl = process.env.PUBLIC_SITE_URL ?? "";
  const supabaseUrl = process.env.API_URL ?? "";

  const body = {
    ok: true,
    mercadopago_access_token_configured: mpToken.length > 0,
    mercadopago_token_kind: mpToken.startsWith("TEST-")
      ? "test"
      : mpToken.startsWith("APP_USR-")
      ? "production"
      : mpToken
      ? "unknown"
      : null,
    public_site_url_configured: siteUrl.length > 0,
    public_site_url: siteUrl || null,
    webhook_url: supabaseUrl ? `${supabaseUrl}/functions/v1/mercadopago-webhook` : null,
  };

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
