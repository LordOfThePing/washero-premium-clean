/**
 * Shared Google Maps JavaScript API loader for the public booking autocomplete
 * and admin demand map.
 *
 * Canonical browser env var (Vite build-time, referrer-restricted):
 *   VITE_GOOGLE_MAPS_PUBLIC_KEY
 *
 * After `.env` was untracked from git (security cleanup), Lovable/Cloudflare
 * production builds only receive this value if it is set in the host's build
 * environment. A public fallback is kept so booking is not bricked when the
 * platform omits the secret — the key is HTTP-referrer restricted in Google Cloud
 * and is not a server credential.
 */

export const GOOGLE_MAPS_PUBLIC_KEY_ENV = "VITE_GOOGLE_MAPS_PUBLIC_KEY";

/** Legacy Vite names accepted temporarily for misconfigured deploys. */
const LEGACY_MAPS_KEY_ENVS = ["VITE_GOOGLE_MAPS_API_KEY", "VITE_GOOGLE_MAPS_KEY"] as const;

/**
 * Public, referrer-restricted Maps JS browser key historically shipped via `.env`.
 * Prefer setting VITE_GOOGLE_MAPS_PUBLIC_KEY in the deployment build env instead.
 */
const PUBLIC_MAPS_KEY_FALLBACK = "AIzaSyAselh7Gae9wMcOOpQIbicEUR9VC_4-Dv8";

const LOAD_TIMEOUT_MS = 10000;

function readEnvString(name: string): string | undefined {
  const env = import.meta.env as Record<string, unknown>;
  const raw = env[name];
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readMapsKey(): {
  key: string | undefined;
  source: "env" | "legacy" | "fallback" | "missing";
} {
  const canonical = readEnvString(GOOGLE_MAPS_PUBLIC_KEY_ENV);
  if (canonical) return { key: canonical, source: "env" };

  for (const name of LEGACY_MAPS_KEY_ENVS) {
    const legacy = readEnvString(name);
    if (legacy) {
      console.warn(
        `[google-maps-loader] Using legacy ${name}. Migrate to ${GOOGLE_MAPS_PUBLIC_KEY_ENV}.`,
      );
      return { key: legacy, source: "legacy" };
    }
  }

  if (PUBLIC_MAPS_KEY_FALLBACK.trim()) {
    if (import.meta.env.DEV) {
      console.info(
        `[google-maps-loader] ${GOOGLE_MAPS_PUBLIC_KEY_ENV} unset; using public referrer-restricted fallback.`,
      );
    }
    return { key: PUBLIC_MAPS_KEY_FALLBACK.trim(), source: "fallback" };
  }

  return { key: undefined, source: "missing" };
}

const resolved = readMapsKey();

export const GOOGLE_MAPS_PUBLIC_KEY = resolved.key;
export const GOOGLE_MAPS_PUBLIC_KEY_SOURCE = resolved.source;

export type MapsLoadFailure =
  | "no_key"
  | "script_failed"
  | "timeout"
  | "maps_missing"
  | "places_missing";

declare global {
  interface Window {
    // Google Maps JS API namespace; typed loosely because @types/google.maps is not a dep.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    google?: any;
    __washeroMapsCoreLoading?: Promise<void>;
  }
}

function hasMapsCore(): boolean {
  return Boolean(window.google?.maps);
}

export function hasPlacesLibrary(): boolean {
  return Boolean(window.google?.maps?.places);
}

function findExistingMapsScript(): HTMLScriptElement | null {
  return document.querySelector<HTMLScriptElement>(
    'script[src*="maps.googleapis.com/maps/api/js"]',
  );
}

function waitFor(
  predicate: () => boolean,
  deadlineMs: number,
  timeoutCode: MapsLoadFailure,
): Promise<void> {
  if (predicate()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + deadlineMs;
    const tick = () => {
      if (predicate()) {
        resolve();
        return;
      }
      if (Date.now() >= deadline) {
        reject(new Error(timeoutCode));
        return;
      }
      window.setTimeout(tick, 50);
    };
    tick();
  });
}

export function loadGoogleMapsApi(options?: { requirePlaces?: boolean }): Promise<void> {
  const requirePlaces = options?.requirePlaces ?? false;
  if (typeof window === "undefined") return Promise.reject(new Error("ssr"));
  if (requirePlaces ? hasPlacesLibrary() : hasMapsCore()) return Promise.resolve();
  if (window.__washeroMapsCoreLoading) {
    return window.__washeroMapsCoreLoading.then(() => {
      if (requirePlaces && !hasPlacesLibrary()) {
        throw new Error("places_missing");
      }
    });
  }

  if (!GOOGLE_MAPS_PUBLIC_KEY) {
    console.error(`[google-maps-loader] Missing ${GOOGLE_MAPS_PUBLIC_KEY_ENV}`);
    return Promise.reject(new Error("no_key"));
  }

  window.__washeroMapsCoreLoading = new Promise<void>((resolve, reject) => {
    let settled = false;

    const finish = (err?: MapsLoadFailure) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      if (err) {
        window.__washeroMapsCoreLoading = undefined;
        reject(new Error(err));
        return;
      }
      resolve();
    };

    const afterScript = () => {
      waitFor(hasMapsCore, LOAD_TIMEOUT_MS, "maps_missing")
        .then(() => {
          if (requirePlaces) {
            return waitFor(hasPlacesLibrary, LOAD_TIMEOUT_MS, "places_missing");
          }
        })
        .then(() => finish())
        .catch((err: unknown) => {
          const code = err instanceof Error ? err.message : "maps_missing";
          finish(
            code === "places_missing" || code === "maps_missing" || code === "timeout"
              ? (code as MapsLoadFailure)
              : "maps_missing",
          );
        });
    };

    const timeoutId = window.setTimeout(() => finish("timeout"), LOAD_TIMEOUT_MS);

    const existing = findExistingMapsScript();
    if (existing) {
      if (requirePlaces ? hasPlacesLibrary() : hasMapsCore()) {
        finish();
        return;
      }
      existing.addEventListener("load", afterScript, { once: true });
      existing.addEventListener("error", () => finish("script_failed"), { once: true });
      const readyState = (existing as HTMLScriptElement & { readyState?: string }).readyState;
      if (
        existing.getAttribute("data-washero-maps-ready") === "true" ||
        readyState === "complete"
      ) {
        afterScript();
      }
      return;
    }

    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(GOOGLE_MAPS_PUBLIC_KEY)}&libraries=places&language=es&region=AR`;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      script.setAttribute("data-washero-maps-ready", "true");
      afterScript();
    };
    script.onerror = () => finish("script_failed");
    document.head.appendChild(script);
  });

  return window.__washeroMapsCoreLoading.then(() => {
    if (requirePlaces && !hasPlacesLibrary()) {
      throw new Error("places_missing");
    }
  });
}

export const MAPS_LOAD_ERROR_MESSAGES: Record<MapsLoadFailure, string> = {
  no_key: `Falta configurar Google Maps (${GOOGLE_MAPS_PUBLIC_KEY_ENV}).`,
  script_failed: "No pudimos cargar Google Maps. Revisá tu conexión e intentá de nuevo.",
  timeout: "No pudimos cargar Google Maps. Tardó demasiado en cargar. Intentá de nuevo.",
  maps_missing: "Google Maps no respondió correctamente.",
  places_missing:
    "No pudimos cargar Google Maps. Revisá que Maps JavaScript API y Places API estén habilitadas.",
};

export function parseMapsLoadFailure(err: unknown): MapsLoadFailure {
  const code = err instanceof Error ? err.message : "";
  if (
    code === "no_key" ||
    code === "script_failed" ||
    code === "timeout" ||
    code === "maps_missing" ||
    code === "places_missing"
  ) {
    return code;
  }
  return "script_failed";
}
