// Coverage matching helpers shared by website + botmaker booking paths.
// deno-lint-ignore-file no-explicit-any
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

export type CoverageZone = {
  id: string;
  name: string;
  aliases: string[];
  center_lat: number | null;
  center_lng: number | null;
  radius_km: number;
  polygon_geojson: any | null;
  display_order: number;
  active: boolean;
};

export type CoverageMatch = {
  zone: CoverageZone | null;
  match_type: "polygon" | "alias" | "radius" | "none";
  distance_km: number | null;
};

const fold = (s: string) =>
  String(s ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// Ray-casting on a GeoJSON Polygon or MultiPolygon (lng,lat coordinate order).
function pointInPolygon(lat: number, lng: number, geo: any): boolean {
  if (!geo || !geo.type) return false;
  const polys: number[][][][] =
    geo.type === "Polygon" ? [geo.coordinates] :
    geo.type === "MultiPolygon" ? geo.coordinates :
    [];
  for (const poly of polys) {
    const ring = poly[0]; // outer ring; ignore holes for our use case
    if (!Array.isArray(ring)) continue;
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      const intersect =
        (yi > lat) !== (yj > lat) &&
        lng < ((xj - xi) * (lat - yi)) / ((yj - yi) || 1e-12) + xi;
      if (intersect) inside = !inside;
    }
    if (inside) return true;
  }
  return false;
}

export async function loadActiveZones(admin: SupabaseClient): Promise<CoverageZone[]> {
  const { data } = await admin
    .from("coverage_zones")
    .select("id,name,aliases,center_lat,center_lng,radius_km,polygon_geojson,display_order,active")
    .eq("active", true)
    .order("display_order", { ascending: true });
  return (data ?? []) as CoverageZone[];
}

export function matchZone(
  zones: CoverageZone[],
  args: { lat?: number | null; lng?: number | null; neighborhood?: string | null },
): CoverageMatch {
  const { lat, lng, neighborhood } = args;
  // 1) polygon
  if (typeof lat === "number" && typeof lng === "number") {
    for (const z of zones) {
      if (z.polygon_geojson && pointInPolygon(lat, lng, z.polygon_geojson)) {
        return { zone: z, match_type: "polygon", distance_km: 0 };
      }
    }
  }
  // 2) alias
  const nb = fold(neighborhood ?? "");
  if (nb) {
    for (const z of zones) {
      const names = [z.name, ...(z.aliases ?? [])].map(fold);
      if (names.some((n) => n && (n === nb || nb.includes(n) || n.includes(nb)))) {
        return { zone: z, match_type: "alias", distance_km: null };
      }
    }
  }
  // 3) radius
  if (typeof lat === "number" && typeof lng === "number") {
    let best: { zone: CoverageZone; dist: number } | null = null;
    for (const z of zones) {
      if (typeof z.center_lat === "number" && typeof z.center_lng === "number") {
        const d = haversineKm(lat, lng, z.center_lat, z.center_lng);
        if (d <= Number(z.radius_km ?? 0) && (!best || d < best.dist)) {
          best = { zone: z, dist: d };
        }
      }
    }
    if (best) return { zone: best.zone, match_type: "radius", distance_km: best.dist };
  }
  return { zone: null, match_type: "none", distance_km: null };
}
