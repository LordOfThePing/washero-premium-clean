import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  type CoverageZoneRow,
  type DemandBooking,
  geoJsonToPaths,
  formatARS,
  formatDemandDateTime,
} from "@/lib/demand-map";
import {
  loadGoogleMapsApi,
  MAPS_LOAD_ERROR_MESSAGES,
  parseMapsLoadFailure,
  type MapsLoadFailure,
} from "@/lib/google-maps-loader";
import { bookingStatusLabels, paymentStatusLabels } from "@/lib/booking-badges";

type Props = {
  zones: CoverageZoneRow[];
  bookings: DemandBooking[];
  zoneCounts: Record<string, number>;
  selectedZoneId: string | null;
  onZoneSelect: (zoneId: string) => void;
  bookingDetailPath: (id: string) => string;
  className?: string;
};

const DEFAULT_CENTER = { lat: -34.6037, lng: -58.3816 };
const ZONE_STROKE = "#2563eb";
const ZONE_FILL_BASE = "#3b82f6";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GMap = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GOverlay = any;

function zoneIntensity(count: number, max: number) {
  const ratio = max > 0 ? count / max : 0;
  return {
    fillOpacity: 0.12 + ratio * 0.42,
    strokeWeight: 1.5 + ratio * 2.5,
  };
}

export function DemandMapCanvas({
  zones,
  bookings,
  zoneCounts,
  selectedZoneId,
  onZoneSelect,
  bookingDetailPath,
  className,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<GMap | null>(null);
  const infoWindowRef = useRef<GOverlay | null>(null);
  const zoneOverlaysRef = useRef<GOverlay[]>([]);
  const markersRef = useRef<GOverlay[]>([]);
  const [mapReady, setMapReady] = useState(false);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [loadError, setLoadError] = useState<MapsLoadFailure | null>(null);

  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      setLoadState("loading");
      setLoadError(null);
      try {
        await loadGoogleMapsApi();
        if (cancelled || !containerRef.current || !window.google?.maps) {
          throw new Error("maps_missing");
        }

        const map = new window.google.maps.Map(containerRef.current, {
          center: DEFAULT_CENTER,
          zoom: 11,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: true,
        });
        mapRef.current = map;
        infoWindowRef.current = new window.google.maps.InfoWindow();
        if (!cancelled) {
          setMapReady(true);
          setLoadState("ready");
        }
      } catch (err) {
        if (!cancelled) {
          setLoadError(parseMapsLoadFailure(err));
          setLoadState("error");
          setMapReady(false);
        }
      }
    };

    void init();
    return () => {
      cancelled = true;
      mapRef.current = null;
      zoneOverlaysRef.current = [];
      markersRef.current = [];
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const google = window.google;
    if (!mapReady || !map || !google?.maps) return;

    for (const o of zoneOverlaysRef.current) o.setMap(null);
    for (const m of markersRef.current) m.setMap(null);
    zoneOverlaysRef.current = [];
    markersRef.current = [];

    const bounds = new google.maps.LatLngBounds();
    let hasBounds = false;
    const maxZoneCount = Math.max(1, ...Object.values(zoneCounts));

    for (const zone of zones) {
      if (!zone.active) continue;
      const count = zoneCounts[zone.id] ?? 0;
      const selected = selectedZoneId === zone.id;
      const intensity = zoneIntensity(count, maxZoneCount);
      const paths = geoJsonToPaths(zone.polygon_geojson);

      const shapeOptions = {
        strokeColor: selected ? "#1d4ed8" : ZONE_STROKE,
        strokeOpacity: selected ? 1 : 0.85,
        strokeWeight: selected ? intensity.strokeWeight + 1 : intensity.strokeWeight,
        fillColor: ZONE_FILL_BASE,
        fillOpacity: selected
          ? Math.min(intensity.fillOpacity + 0.15, 0.75)
          : intensity.fillOpacity,
        clickable: true,
        zIndex: selected ? 2 : 1,
      };

      const attachZoneClick = (overlay: GOverlay) => {
        overlay.addListener("click", () => onZoneSelect(zone.id));
        zoneOverlaysRef.current.push(overlay);
      };

      if (paths.length > 0) {
        for (const path of paths) {
          if (path.length < 3) continue;
          const polygon = new google.maps.Polygon({ ...shapeOptions, paths: path, map });
          attachZoneClick(polygon);
          for (const p of path) {
            bounds.extend(p);
            hasBounds = true;
          }
        }
        continue;
      }

      if (zone.center_lat != null && zone.center_lng != null) {
        const center = { lat: zone.center_lat, lng: zone.center_lng };
        const radiusM = Math.max((zone.radius_km || 1) * 1000, 200);
        const circle = new google.maps.Circle({
          ...shapeOptions,
          map,
          center,
          radius: radiusM,
        });
        attachZoneClick(circle);
        bounds.extend(center);
        hasBounds = true;
      }
    }

    for (const b of bookings) {
      if (b.address_lat == null || b.address_lng == null) continue;
      const pos = { lat: b.address_lat, lng: b.address_lng };
      const marker = new google.maps.Marker({
        map,
        position: pos,
        title: b.customer_name,
        zIndex: 10,
      });
      marker.addListener("click", () => {
        const iw = infoWindowRef.current;
        if (!iw) return;
        const addr = b.formatted_address || b.address || "—";
        const detailUrl = bookingDetailPath(b.id);
        iw.setContent(`
          <div style="font-family:system-ui,sans-serif;max-width:260px;padding:2px 0">
            <p style="margin:0 0 6px;font-weight:600">${escapeHtml(b.customer_name)}</p>
            <p style="margin:0 0 4px;font-size:13px">${escapeHtml(b.service_name)}</p>
            <p style="margin:0 0 4px;font-size:12px;color:#555">${escapeHtml(formatDemandDateTime(b.scheduled_date, b.scheduled_time))}</p>
            <p style="margin:0 0 4px;font-size:12px">${escapeHtml(bookingStatusLabels[b.booking_status] ?? b.booking_status)} · ${escapeHtml(paymentStatusLabels[b.payment_status] ?? b.payment_status)}</p>
            <p style="margin:0 0 6px;font-size:12px;font-weight:500">${escapeHtml(formatARS(b.price))}</p>
            <p style="margin:0 0 8px;font-size:11px;color:#666">${escapeHtml(addr)}</p>
            <a href="${escapeHtml(detailUrl)}" style="font-size:12px;color:#2563eb">Ver reserva</a>
          </div>
        `);
        iw.open({ map, anchor: marker });
      });
      markersRef.current.push(marker);
      bounds.extend(pos);
      hasBounds = true;
    }

    if (hasBounds) {
      map.fitBounds(bounds, 48);
      const listener = google.maps.event.addListenerOnce(map, "idle", () => {
        const z = map.getZoom();
        if (z && z > 15) map.setZoom(15);
      });
      void listener;
    } else {
      map.setCenter(DEFAULT_CENTER);
      map.setZoom(11);
    }
  }, [mapReady, zones, bookings, zoneCounts, selectedZoneId, onZoneSelect, bookingDetailPath]);

  if (loadState === "error") {
    return (
      <div
        className={`flex min-h-[220px] items-center justify-center rounded-lg border border-dashed bg-muted/30 px-4 text-center text-sm text-muted-foreground ${className ?? ""}`}
      >
        {loadError ? MAPS_LOAD_ERROR_MESSAGES[loadError] : "No se pudo cargar Google Maps."}
      </div>
    );
  }

  return (
    <div className={`relative min-h-[280px] overflow-hidden rounded-lg border ${className ?? ""}`}>
      <div ref={containerRef} className="h-full min-h-[280px] w-full" />
      {loadState === "loading" && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/70">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}
    </div>
  );
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
