import { useEffect, useRef, useState } from "react";
import { Loader2, MapPin, AlertCircle, CheckCircle2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_PUBLIC_KEY as string | undefined;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  interface Window { google?: any; __washeroMapsLoading?: Promise<void> }
}

function loadMapsApi(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("ssr"));
  if (window.google?.maps?.places) return Promise.resolve();
  if (window.__washeroMapsLoading) return window.__washeroMapsLoading;
  if (!MAPS_KEY) return Promise.reject(new Error("no_key"));
  window.__washeroMapsLoading = new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${MAPS_KEY}&libraries=places&language=es&region=AR&loading=async`;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("script_failed"));
    document.head.appendChild(s);
  });
  return window.__washeroMapsLoading;
}

export type PlaceSelection = {
  place_id: string;
  formatted_address: string;
  lat: number;
  lng: number;
  neighborhood: string | null;
};

export function PlacesAutocomplete({
  value,
  onChange,
  onSelect,
  placeholder,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  onSelect: (p: PlaceSelection | null) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const acRef = useRef<any>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "selected" | "error">(MAPS_KEY ? "loading" : "error");

  useEffect(() => {
    if (!MAPS_KEY) return;
    let cancelled = false;
    loadMapsApi()
      .then(() => {
        if (cancelled || !inputRef.current || !window.google?.maps?.places) return;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ac = new (window.google.maps.places as any).Autocomplete(inputRef.current, {
          componentRestrictions: { country: "ar" },
          fields: ["place_id", "formatted_address", "geometry", "address_components"],
          types: ["address"],
        });
        ac.addListener("place_changed", () => {
          const p = ac.getPlace();
          if (!p?.place_id || !p.geometry?.location) {
            onSelect(null);
            setStatus("ready");
            return;
          }
          // Try to extract a neighborhood-like component
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const comps: any[] = p.address_components ?? [];
          const findType = (t: string) => comps.find((c) => c.types?.includes(t))?.long_name ?? null;
          const neighborhood =
            findType("sublocality_level_1") ||
            findType("sublocality") ||
            findType("neighborhood") ||
            findType("locality") ||
            findType("administrative_area_level_2") ||
            null;
          const sel: PlaceSelection = {
            place_id: p.place_id,
            formatted_address: p.formatted_address ?? "",
            lat: p.geometry.location.lat(),
            lng: p.geometry.location.lng(),
            neighborhood,
          };
          onChange(sel.formatted_address);
          onSelect(sel);
          setStatus("selected");
        });
        acRef.current = ac;
        setStatus("ready");
      })
      .catch(() => setStatus("error"));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-1.5">
      <div className="relative">
        <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          ref={inputRef}
          className="pl-9"
          placeholder={placeholder ?? "Buscá tu dirección"}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            // user typing invalidates prior selection
            if (status === "selected") setStatus("ready");
            onSelect(null);
          }}
          disabled={disabled || status === "loading"}
          autoComplete="off"
        />
      </div>
      <div className={cn(
        "flex items-center gap-1 text-xs",
        status === "selected" && "text-emerald-600",
        status === "error" && "text-destructive",
        (status === "loading" || status === "ready" || status === "idle") && "text-muted-foreground",
      )}>
        {status === "loading" && (<><Loader2 className="h-3 w-3 animate-spin" /> Cargando buscador de direcciones…</>)}
        {status === "ready" && (<>Empezá a escribir y elegí una sugerencia.</>)}
        {status === "selected" && (<><CheckCircle2 className="h-3 w-3" /> Dirección seleccionada.</>)}
        {status === "error" && (<><AlertCircle className="h-3 w-3" /> No pudimos cargar el buscador. Revisá la conexión.</>)}
      </div>
    </div>
  );
}
