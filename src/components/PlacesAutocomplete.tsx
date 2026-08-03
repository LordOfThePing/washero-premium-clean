import { useEffect, useRef, useState } from "react";
import { Loader2, MapPin, AlertCircle, CheckCircle2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { extractLocalityCandidates, type CoverageAddressComponent } from "@/lib/coverage-zones";
import {
  GOOGLE_MAPS_PUBLIC_KEY,
  GOOGLE_MAPS_PUBLIC_KEY_ENV,
  MAPS_LOAD_ERROR_MESSAGES,
  hasPlacesLibrary,
  loadGoogleMapsApi,
  parseMapsLoadFailure,
  type MapsLoadFailure,
} from "@/lib/google-maps-loader";

export type PlaceSelection = {
  place_id: string;
  formatted_address: string;
  lat: number;
  lng: number;
  neighborhood: string | null;
  locality_candidates: string[];
  address_components: CoverageAddressComponent[];
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
  const pacBumpRef = useRef<(() => void) | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "selected" | "error">(
    GOOGLE_MAPS_PUBLIC_KEY ? "loading" : "error",
  );
  const [errorKind, setErrorKind] = useState<MapsLoadFailure | null>(
    GOOGLE_MAPS_PUBLIC_KEY ? null : "no_key",
  );

  useEffect(() => {
    if (!GOOGLE_MAPS_PUBLIC_KEY) {
      console.error(`[PlacesAutocomplete] Missing ${GOOGLE_MAPS_PUBLIC_KEY_ENV}`);
      setErrorKind("no_key");
      setStatus("error");
      return;
    }

    let cancelled = false;

    const attachAutocomplete = (): boolean => {
      const input = inputRef.current;
      if (!input || !hasPlacesLibrary()) return false;
      if (acRef.current) return true;

      // Legacy Autocomplete remains the supported client integration in this app.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ac = new (window.google.maps.places as any).Autocomplete(input, {
        componentRestrictions: { country: "ar" },
        fields: ["place_id", "formatted_address", "geometry", "address_components"],
        types: ["address"],
      });
      // Keep dropdown above modals (CSS handles z-index; this covers late-mounted containers).
      const bumpPacZIndex = () => {
        document.querySelectorAll<HTMLElement>(".pac-container").forEach((el) => {
          el.style.zIndex = "999999";
          el.style.pointerEvents = "auto";
        });
      };
      pacBumpRef.current = bumpPacZIndex;
      input.addEventListener("focus", bumpPacZIndex);
      input.addEventListener("input", bumpPacZIndex);

      ac.addListener("place_changed", () => {
        const p = ac.getPlace();
        if (!p?.place_id || !p.geometry?.location) {
          onSelect(null);
          setStatus("ready");
          return;
        }
        const comps: CoverageAddressComponent[] = (p.address_components ?? []).map(
          (c: { long_name?: string; short_name?: string; types?: string[] }) => ({
            long_name: c.long_name,
            short_name: c.short_name,
            types: c.types,
          }),
        );
        const findType = (t: string) => comps.find((c) => c.types?.includes(t))?.long_name ?? null;
        const neighborhood =
          findType("locality") ||
          findType("sublocality_level_1") ||
          findType("sublocality") ||
          findType("neighborhood") ||
          findType("postal_town") ||
          findType("administrative_area_level_2") ||
          null;
        const locality_candidates = extractLocalityCandidates(comps, [neighborhood]);
        const sel: PlaceSelection = {
          place_id: p.place_id,
          formatted_address: p.formatted_address ?? "",
          lat: p.geometry.location.lat(),
          lng: p.geometry.location.lng(),
          neighborhood,
          locality_candidates,
          address_components: comps,
        };
        onChange(sel.formatted_address);
        onSelect(sel);
        setStatus("selected");
      });
      acRef.current = ac;
      return true;
    };

    const fail = (kind: MapsLoadFailure) => {
      if (cancelled) return;
      setErrorKind(kind);
      setStatus("error");
    };

    loadGoogleMapsApi({ requirePlaces: true })
      .then(() => {
        if (cancelled) return;
        if (!hasPlacesLibrary()) {
          console.error("[PlacesAutocomplete] Places library missing after load");
          fail("places_missing");
          return;
        }
        if (attachAutocomplete()) {
          setStatus("ready");
          return;
        }
        // Input ref can lag behind dialog mount; retry briefly before failing.
        let attempts = 0;
        const retry = () => {
          if (cancelled) return;
          if (attachAutocomplete()) {
            setStatus("ready");
            return;
          }
          attempts += 1;
          if (attempts >= 20) {
            console.error("[PlacesAutocomplete] Address input not available for autocomplete");
            fail("script_failed");
            return;
          }
          window.setTimeout(retry, 50);
        };
        retry();
      })
      .catch((err) => {
        if (cancelled) return;
        const kind = parseMapsLoadFailure(err);
        console.error(`[PlacesAutocomplete] Google Maps load failed: ${kind}`, err);
        fail(kind);
      });

    const inputEl = inputRef.current;
    return () => {
      cancelled = true;
      const bump = pacBumpRef.current;
      if (inputEl && bump) {
        inputEl.removeEventListener("focus", bump);
        inputEl.removeEventListener("input", bump);
      }
      pacBumpRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const errorMessage = errorKind
    ? MAPS_LOAD_ERROR_MESSAGES[errorKind]
    : MAPS_LOAD_ERROR_MESSAGES.script_failed;

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
      <div
        className={cn(
          "flex items-center gap-1 text-xs",
          status === "selected" && "text-emerald-600",
          status === "error" && "text-destructive",
          (status === "loading" || status === "ready" || status === "idle") &&
            "text-muted-foreground",
        )}
      >
        {status === "loading" && (
          <>
            <Loader2 className="h-3 w-3 animate-spin" /> Cargando buscador de direcciones…
          </>
        )}
        {status === "ready" && <>Empezá a escribir y elegí una sugerencia.</>}
        {status === "selected" && (
          <>
            <CheckCircle2 className="h-3 w-3" /> Dirección seleccionada.
          </>
        )}
        {status === "error" && (
          <>
            <AlertCircle className="h-3 w-3" /> {errorMessage}
          </>
        )}
      </div>
    </div>
  );
}
