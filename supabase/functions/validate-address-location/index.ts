// Edge Function: validate-address-location
// Verifies a Google place_id (server-side via Google Places API New) and returns
// whether the resulting lat/lng falls inside an active coverage zone.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { loadActiveZones, matchZone } from "../_shared/coverage.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type Payload = {
  place_id?: string;
  formatted_address?: string;
  lat?: number;
  lng?: number;
  neighborhood?: string;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  let body: Payload;
  try { body = await req.json(); } catch { return json({ ok: false, error: "invalid_json" }, 400); }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const GOOGLE_KEY = Deno.env.get("GOOGLE_MAPS_SERVER_KEY") ?? "";
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  let lat = typeof body.lat === "number" ? body.lat : null;
  let lng = typeof body.lng === "number" ? body.lng : null;
  let formatted_address = body.formatted_address ?? null;
  const place_id = body.place_id ?? null;

  // If place_id is provided, look it up server-side for an authoritative lat/lng.
  if (place_id && GOOGLE_KEY) {
    try {
      const r = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(place_id)}`, {
        headers: {
          "X-Goog-Api-Key": GOOGLE_KEY,
          "X-Goog-FieldMask": "id,formattedAddress,location",
        },
      });
      if (r.ok) {
        const d = await r.json() as { location?: { latitude: number; longitude: number }; formattedAddress?: string };
        if (d.location) { lat = d.location.latitude; lng = d.location.longitude; }
        if (d.formattedAddress) formatted_address = d.formattedAddress;
      } else {
        console.warn("[validate-address-location] places lookup failed", r.status, await r.text());
      }
    } catch (e) {
      console.warn("[validate-address-location] places exception", e);
    }
  }

  const zones = await loadActiveZones(admin);
  const match = matchZone(zones, { lat, lng, neighborhood: body.neighborhood });

  return json({
    ok: true,
    inside_coverage: !!match.zone,
    zone: match.zone ? { id: match.zone.id, name: match.zone.name } : null,
    match_type: match.match_type,
    distance_km: match.distance_km,
    place_id,
    formatted_address,
    lat,
    lng,
  });
});
