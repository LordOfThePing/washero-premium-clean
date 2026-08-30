import { db } from "@/integrations/db/client";

export const ACTIVE_COVERAGE_ZONES_QUERY_KEY = ["coverage_zones", "active"] as const;
export const ADMIN_COVERAGE_ZONES_QUERY_KEY = ["admin", "coverage_zones"] as const;
export const LOOKUP_COVERAGE_ZONES_QUERY_KEY = ["lookup", "coverage_zones"] as const;

export type ActiveCoverageZone = {
  id: string;
  name: string;
  aliases: string[];
  display_order: number;
};

export type CoverageAddressComponent = {
  long_name?: string;
  short_name?: string;
  types?: string[];
};

/** Locality-like Google address component types used for coverage matching. */
export const COVERAGE_LOCALITY_COMPONENT_TYPES = [
  "locality",
  "sublocality",
  "sublocality_level_1",
  "neighborhood",
  "postal_town",
  "administrative_area_level_2",
] as const;

/** Broad admin areas that must never alone approve coverage. */
const REJECTED_BROAD_COMPONENT_TYPES = new Set([
  "administrative_area_level_1",
  "country",
  "political",
]);

export function normalizeCoverageText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[.,/#'"´`]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractLocalityCandidates(
  components: CoverageAddressComponent[] | null | undefined,
  extras: Array<string | null | undefined> = [],
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  const push = (raw: string | null | undefined) => {
    const value = String(raw ?? "").trim();
    if (!value) return;
    const key = normalizeCoverageText(value);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(value);
  };

  for (const component of components ?? []) {
    const types = Array.isArray(component.types) ? component.types : [];
    if (
      types.some((t) => REJECTED_BROAD_COMPONENT_TYPES.has(t)) &&
      !types.some((t) => (COVERAGE_LOCALITY_COMPONENT_TYPES as readonly string[]).includes(t))
    ) {
      continue;
    }
    if (!types.some((t) => (COVERAGE_LOCALITY_COMPONENT_TYPES as readonly string[]).includes(t))) {
      continue;
    }
    push(component.long_name);
    push(component.short_name);
  }

  for (const extra of extras) push(extra);
  return out;
}

export type MatchableCoverageZone = {
  id: string;
  name: string;
  aliases?: string[] | null;
  active?: boolean;
  center_lat?: number | null;
  center_lng?: number | null;
  radius_km?: number | null;
  polygon_geojson?: unknown;
  display_order?: number;
};

export type CoverageZoneMatch = {
  zone: MatchableCoverageZone | null;
  match_type: "polygon" | "alias" | "radius" | "none";
  distance_km: number | null;
};

function zoneLabels(zone: MatchableCoverageZone): string[] {
  return [zone.name, ...(zone.aliases ?? [])]
    .map((value) => normalizeCoverageText(value))
    .filter(Boolean);
}

function pointInPolygon(lat: number, lng: number, geo: unknown): boolean {
  if (!geo || typeof geo !== "object") return false;
  const g = geo as { type?: string; coordinates?: unknown };
  if (!g.type) return false;
  const polys: number[][][][] =
    g.type === "Polygon"
      ? [g.coordinates as number[][][]]
      : g.type === "MultiPolygon"
        ? (g.coordinates as number[][][][])
        : [];
  for (const poly of polys) {
    const ring = poly?.[0];
    if (!Array.isArray(ring)) continue;
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i] ?? [];
      const [xj, yj] = ring[j] ?? [];
      if (
        typeof xi !== "number" ||
        typeof yi !== "number" ||
        typeof xj !== "number" ||
        typeof yj !== "number"
      ) {
        continue;
      }
      const intersect =
        yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi || 1e-12) + xi;
      if (intersect) inside = !inside;
    }
    if (inside) return true;
  }
  return false;
}

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

/**
 * Match a Google place against active coverage zones.
 * Prefer exact normalized equality on locality-like address components.
 */
export function matchCoverageZone(
  zones: MatchableCoverageZone[],
  args: {
    lat?: number | null;
    lng?: number | null;
    localityCandidates?: Array<string | null | undefined>;
    neighborhood?: string | null;
  },
): CoverageZoneMatch {
  const activeZones = zones.filter((z) => z.active !== false);

  if (typeof args.lat === "number" && typeof args.lng === "number") {
    for (const z of activeZones) {
      if (z.polygon_geojson && pointInPolygon(args.lat, args.lng, z.polygon_geojson)) {
        return { zone: z, match_type: "polygon", distance_km: 0 };
      }
    }
  }

  const candidates = [...(args.localityCandidates ?? []), args.neighborhood]
    .map((value) => normalizeCoverageText(value))
    .filter(Boolean);
  const uniqueCandidates = [...new Set(candidates)];

  if (uniqueCandidates.length > 0) {
    for (const z of activeZones) {
      const labels = zoneLabels(z);
      if (labels.some((label) => uniqueCandidates.includes(label))) {
        return { zone: z, match_type: "alias", distance_km: null };
      }
    }
  }

  if (typeof args.lat === "number" && typeof args.lng === "number") {
    let best: { zone: MatchableCoverageZone; dist: number } | null = null;
    for (const z of activeZones) {
      if (typeof z.center_lat === "number" && typeof z.center_lng === "number") {
        const d = haversineKm(args.lat, args.lng, z.center_lat, z.center_lng);
        const radius = Number(z.radius_km ?? 0);
        if (d <= radius && (!best || d < best.dist)) {
          best = { zone: z, dist: d };
        }
      }
    }
    if (best) return { zone: best.zone, match_type: "radius", distance_km: best.dist };
  }

  return { zone: null, match_type: "none", distance_km: null };
}

export function formatCoverageCopy(zoneNames: string[]): string {
  const names = [...new Set(zoneNames.map((n) => n.trim()).filter(Boolean))];
  if (names.length === 0) {
    return "Por ahora no hay zonas de cobertura activas. Escribinos por WhatsApp y te ayudamos.";
  }
  if (names.length === 1) {
    return `Por ahora Washero trabaja en ${names[0]}.`;
  }
  if (names.length === 2) {
    return `Por ahora Washero trabaja en ${names[0]} y ${names[1]}.`;
  }
  const head = names.slice(0, -1).join(", ");
  const last = names[names.length - 1];
  return `Por ahora Washero trabaja en ${head} y ${last}.`;
}

export function sortCoverageZoneNames(
  zones: Array<{ name: string; display_order?: number | null }>,
): string[] {
  return [...zones]
    .sort((a, b) => {
      const orderA = Number(a.display_order ?? 0);
      const orderB = Number(b.display_order ?? 0);
      if (orderA !== orderB) return orderA - orderB;
      return a.name.localeCompare(b.name, "es");
    })
    .map((z) => z.name);
}

export async function fetchActiveCoverageZones(): Promise<ActiveCoverageZone[]> {
  const { data, error } = await db
    .from("coverage_zones")
    .select("id,name,aliases,display_order")
    .eq("active", true)
    .order("display_order")
    .order("name");
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: String(row.id),
    name: String(row.name),
    aliases: Array.isArray(row.aliases) ? row.aliases.map(String) : [],
    display_order: Number(row.display_order) || 0,
  }));
}

export function coverageZonesQueryOptions() {
  return {
    queryKey: ACTIVE_COVERAGE_ZONES_QUERY_KEY,
    queryFn: fetchActiveCoverageZones,
    staleTime: 30_000,
  } as const;
}
