// Supabase Edge Function: mp-diagnostics
// Returns Mercado Pago configuration status without exposing token values.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const mpToken = Deno.env.get("MERCADOPAGO_ACCESS_TOKEN") ?? "";
  const siteUrl = Deno.env.get("PUBLIC_SITE_URL") ?? "";

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
    webhook_url:
      "https://domslcbxgqbylmciqrxt.supabase.co/functions/v1/mercadopago-webhook",
  };

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
