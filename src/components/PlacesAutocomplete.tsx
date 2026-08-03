import { useEffect, useRef, useState } from "react";
import { Loader2, MapPin, AlertCircle, CheckCircle2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { extractLocalityCandidates, type CoverageAddressComponent } from "@/lib/coverage-zones";

function readMapsKey(): string | undefined {
  const raw = import.meta.env.VITE_GOOGLE_MAPS_PUBLIC_KEY;
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

const MAPS_KEY = readMapsKey();
const LOAD_TIMEOUT_MS = 8000;

type LoadFailure = "no_key" | "script_failed" | "timeout" | "places_missing";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  interface Window {
    google?: any;
    __washeroMapsLoading?: Promise<void>;
  }
}

function hasPlacesLibrary(): boolean {
  return Boolean(window.google?.maps?.places);
}

function findExistingMapsScript(): HTMLScriptElement | null {
  return document.querySelector<HTMLScriptElement>(
    'script[src*="maps.googleapis.com/maps/api/js"]',
  );
}

function waitForPlaces(deadlineMs: number): Promise<void> {
  if (hasPlacesLibrary()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + deadlineMs;
    const tick = () => {
      if (hasPlacesLibrary()) {
        resolve();
        return;
      }
      if (Date.now() >= deadline) {
        reject(new Error("places_missing"));
        return;
      }
      window.setTimeout(tick, 50);
    };
    tick();
  });
}

function loadMapsApi(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("ssr"));
  if (hasPlacesLibrary()) return Promise.resolve();
  if (window.__washeroMapsLoading) return window.__washeroMapsLoading;

  if (!MAPS_KEY) {
    console.error("[PlacesAutocomplete] Missing VITE_GOOGLE_MAPS_PUBLIC_KEY");
    return Promise.reject(new Error("no_key"));
  }

  window.__washeroMapsLoading = new Promise<void>((resolve, reject) => {
    let settled = false;

    const finish = (err?: LoadFailure) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      if (err) {
        window.__washeroMapsLoading = undefined;
        reject(new Error(err));
        return;
      }
      resolve();
    };

    const afterScriptEvent = () => {
      waitForPlaces(LOAD_TIMEOUT_MS)
        .then(() => {
          if (!hasPlacesLibrary()) {
            console.error("[PlacesAutocomplete] Places library missing after script load");
            finish("places_missing");
            return;
          }
          finish();
        })
        .catch(() => {
          console.error("[PlacesAutocomplete] Places library missing after script load");
          finish("places_missing");
        });
    };

    const timeoutId = window.setTimeout(() => {
      console.error("[PlacesAutocomplete] Google Maps script load timed out");
      finish("timeout");
    }, LOAD_TIMEOUT_MS);

    const existing = findExistingMapsScript();
    if (existing) {
      if (hasPlacesLibrary()) {
        finish();
        return;
      }
      existing.addEventListener("load", afterScriptEvent, { once: true });
      existing.addEventListener(
        "error",
        () => {
          console.error("[PlacesAutocomplete] Google Maps script failed to load");
          finish("script_failed");
        },
        { once: true },
      );
      // Script may already be loaded (no load event will fire).
      if (
        existing.getAttribute("data-washero-maps-ready") === "true" ||
        existing.readyState === "complete"
      ) {
        afterScriptEvent();
      }
      return;
    }

    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(MAPS_KEY)}&libraries=places&language=es&region=AR`;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      script.setAttribute("data-washero-maps-ready", "true");
      afterScriptEvent();
    };
    script.onerror = () => {
      console.error("[PlacesAutocomplete] Google Maps script failed to load");
      finish("script_failed");
    };
    document.head.appendChild(script);
  });

  return window.__washeroMapsLoading;
}

const ERROR_MESSAGES: Record<LoadFailure, string> = {
  no_key: "Falta configurar Google Maps.",
  script_failed: "No pudimos cargar Google Maps. Revisá tu conexión e intentá de nuevo.",
  timeout: "No pudimos cargar Google Maps. Tardó demasiado en cargar. Intentá de nuevo.",
  places_missing:
    "No pudimos cargar Google Maps. Revisá que Maps JavaScript API y Places API estén habilitadas.",
};

function parseLoadFailure(err: unknown): LoadFailure {
  const code = err instanceof Error ? err.message : "";
  if (
    code === "no_key" ||
    code === "script_failed" ||
    code === "timeout" ||
    code === "places_missing"
  ) {
    return code;
  }
  return "script_failed";
}

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
    MAPS_KEY ? "loading" : "error",
  );
  const [errorKind, setErrorKind] = useState<LoadFailure | null>(MAPS_KEY ? null : "no_key");

  useEffect(() => {
    if (!MAPS_KEY) {
      console.error("[PlacesAutocomplete] Missing VITE_GOOGLE_MAPS_PUBLIC_KEY");
      setErrorKind("no_key");
      setStatus("error");
      return;
    }

    let cancelled = false;

    const attachAutocomplete = (): boolean => {
      const input = inputRef.current;
      if (!input || !window.google?.maps?.places) return false;
      if (acRef.current) return true;

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

    const fail = (kind: LoadFailure) => {
      if (cancelled) return;
      setErrorKind(kind);
      setStatus("error");
    };

    loadMapsApi()
      .then(() => {
        if (cancelled) return;
        if (!window.google?.maps?.places) {
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
        const kind = parseLoadFailure(err);
        if (kind === "timeout") {
          console.error("[PlacesAutocomplete] Google Maps script load timed out");
        } else if (kind === "script_failed") {
          console.error("[PlacesAutocomplete] Google Maps script failed to load");
        } else if (kind === "places_missing") {
          console.error("[PlacesAutocomplete] Places library missing");
        }
        fail(kind);
      });

    return () => {
      cancelled = true;
      const input = inputRef.current;
      const bump = pacBumpRef.current;
      if (input && bump) {
        input.removeEventListener("focus", bump);
        input.removeEventListener("input", bump);
      }
      pacBumpRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const errorMessage = errorKind ? ERROR_MESSAGES[errorKind] : ERROR_MESSAGES.script_failed;

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
