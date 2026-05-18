const LOAD_TIMEOUT_MS = 10000;

function readMapsKey(): string | undefined {
  const raw = import.meta.env.VITE_GOOGLE_MAPS_PUBLIC_KEY;
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export const GOOGLE_MAPS_PUBLIC_KEY = readMapsKey();

export type MapsLoadFailure = "no_key" | "script_failed" | "timeout" | "maps_missing";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  interface Window {
    google?: any;
    __washeroMapsCoreLoading?: Promise<void>;
  }
}

function hasMapsCore(): boolean {
  return Boolean(window.google?.maps);
}

function findExistingMapsScript(): HTMLScriptElement | null {
  return document.querySelector<HTMLScriptElement>(
    'script[src*="maps.googleapis.com/maps/api/js"]',
  );
}

function waitForMapsCore(deadlineMs: number): Promise<void> {
  if (hasMapsCore()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + deadlineMs;
    const tick = () => {
      if (hasMapsCore()) {
        resolve();
        return;
      }
      if (Date.now() >= deadline) {
        reject(new Error("maps_missing"));
        return;
      }
      window.setTimeout(tick, 50);
    };
    tick();
  });
}

export function loadGoogleMapsApi(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("ssr"));
  if (hasMapsCore()) return Promise.resolve();
  if (window.__washeroMapsCoreLoading) return window.__washeroMapsCoreLoading;

  if (!GOOGLE_MAPS_PUBLIC_KEY) {
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
      waitForMapsCore(LOAD_TIMEOUT_MS)
        .then(() => finish())
        .catch(() => finish("maps_missing"));
    };

    const timeoutId = window.setTimeout(() => finish("timeout"), LOAD_TIMEOUT_MS);

    const existing = findExistingMapsScript();
    if (existing) {
      if (hasMapsCore()) {
        finish();
        return;
      }
      existing.addEventListener("load", afterScript, { once: true });
      existing.addEventListener("error", () => finish("script_failed"), { once: true });
      if (
        existing.getAttribute("data-washero-maps-ready") === "true" ||
        existing.readyState === "complete"
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

  return window.__washeroMapsCoreLoading;
}

export const MAPS_LOAD_ERROR_MESSAGES: Record<MapsLoadFailure, string> = {
  no_key: "Falta configurar VITE_GOOGLE_MAPS_PUBLIC_KEY.",
  script_failed: "No se pudo cargar Google Maps.",
  timeout: "Google Maps tardó demasiado en cargar.",
  maps_missing: "Google Maps no respondió correctamente.",
};

export function parseMapsLoadFailure(err: unknown): MapsLoadFailure {
  const code = err instanceof Error ? err.message : "";
  if (
    code === "no_key" ||
    code === "script_failed" ||
    code === "timeout" ||
    code === "maps_missing"
  ) {
    return code;
  }
  return "script_failed";
}
