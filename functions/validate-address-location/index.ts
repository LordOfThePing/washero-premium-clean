// Edge Function: validate-address-location
// Verifies a Google place_id (server-side via Google Places API New) and returns
// whether the resulting lat/lng falls inside an active coverage zone.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  extractLocalityCandidates,
  loadActiveZones,
  matchZone,
  type CoverageAddressComponent,
} from "../_shared/coverage.ts";

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
  locality_candidates?: string[];
  address_components?: CoverageAddressComponent[];
  address_type?: "street" | "private_neighborhood";
  private_neighborhood_id?: string;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  let body: Payload;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  const API_URL = Deno.env.get("API_URL")!;
  const SERVICE_ROLE = Deno.env.get("SERVICE_ROLE_KEY")!;
  const GOOGLE_KEY = Deno.env.get("GOOGLE_MAPS_SERVER_KEY") ?? "";
  const admin = createClient(API_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  if (body.address_type === "private_neighborhood") {
    const privateNeighborhoodId = (body.private_neighborhood_id ?? "").trim();
    if (!privateNeighborhoodId) {
      console.warn(
        "[validate-address-location] missing private_neighborhood_id for private_neighborhood address_type",
      );
      return json({ ok: false, error: "missing_private_neighborhood_id" }, 400);
    }

    const { data, error } = await admin
      .from("private_neighborhoods")
      .select(
        "id,name,active,coverage_zone_id,coverage_zone_name,canonical_address,formatted_address,lat,lng",
      )
      .eq("id", privateNeighborhoodId)
      .maybeSingle();

    if (error || !data || !data.active) {
      console.warn(
        "[validate-address-location] invalid or inactive private_neighborhood_id",
        privateNeighborhoodId,
        error,
      );
      return json({ ok: false, error: "invalid_private_neighborhood" }, 400);
    }

    const zone = data.coverage_zone_id
      ? {
          id: data.coverage_zone_id as string,
          name: (data.coverage_zone_name as string | null) ?? "",
        }
      : data.coverage_zone_name
        ? { id: null, name: data.coverage_zone_name as string }
        : null;

    return json({
      ok: true,
      inside_coverage: true,
      zone,
      match_type: "private_neighborhood",
      distance_km: null,
      place_id: null,
      formatted_address: data.formatted_address,
      canonical_address: data.canonical_address,
      lat: data.lat,
      lng: data.lng,
      coverage_zone_id: data.coverage_zone_id,
      coverage_zone_name: data.coverage_zone_name,
      private_neighborhood: {
        id: data.id,
        name: data.name,
      },
    });
  }

  let lat = typeof body.lat === "number" ? body.lat : null;
  let lng = typeof body.lng === "number" ? body.lng : null;
  let formatted_address = body.formatted_address ?? null;
  const place_id = body.place_id ?? null;
  let serverComponents: CoverageAddressComponent[] = [];

  // If place_id is provided, look it up server-side for an authoritative lat/lng + components.
  if (place_id && GOOGLE_KEY) {
    try {
      const r = await fetch(
        `https://places.googleapis.com/v1/places/${encodeURIComponent(place_id)}`,
        {
          headers: {
            "X-Goog-Api-Key": GOOGLE_KEY,
            "X-Goog-FieldMask": "id,formattedAddress,location,addressComponents",
          },
        },
      );
      if (r.ok) {
        const d = (await r.json()) as {
          location?: { latitude: number; longitude: number };
          formattedAddress?: string;
          addressComponents?: CoverageAddressComponent[];
        };
        if (d.location) {
          lat = d.location.latitude;
          lng = d.location.longitude;
        }
        if (d.formattedAddress) formatted_address = d.formattedAddress;
        if (Array.isArray(d.addressComponents)) serverComponents = d.addressComponents;
      } else {
        console.warn("[validate-address-location] places lookup failed", r.status, await r.text());
      }
    } catch (e) {
      console.warn("[validate-address-location] places exception", e);
    }
  }

  const localityCandidates = extractLocalityCandidates(
    [
      ...serverComponents,
      ...(Array.isArray(body.address_components) ? body.address_components : []),
    ],
    [
      ...(Array.isArray(body.locality_candidates) ? body.locality_candidates : []),
      body.neighborhood,
    ],
  );

  const zones = await loadActiveZones(admin);
  const match = matchZone(zones, {
    lat,
    lng,
    neighborhood: body.neighborhood,
    localityCandidates,
  });

  if (!match.zone) {
    console.info("[validate-address-location] outside_coverage", {
      place_id,
      formatted_address,
      localityCandidates,
      neighborhood: body.neighborhood,
      active_zone_count: zones.length,
    });
  }

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
    locality_candidates: localityCandidates,
  });
});
