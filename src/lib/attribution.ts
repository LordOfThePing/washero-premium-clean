import { useEffect, useMemo, useState } from "react";

export type AttributionSearchInput = {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
  qr?: string;
  gclid?: string;
  gbraid?: string;
  wbraid?: string;
};

export type BookingAttribution = {
  marketing_source: string | null;
  marketing_medium: string | null;
  marketing_campaign: string | null;
  marketing_content: string | null;
  marketing_term: string | null;
  qr_code_slug: string | null;
  landing_url: string | null;
  referrer_url: string | null;
  gclid: string | null;
  gbraid: string | null;
  wbraid: string | null;
  captured_at: number | null;
};

type StoredAttribution = {
  data: BookingAttribution;
  expires_at: number;
};

const STORAGE_KEY = "washero:attribution:v1";
const TTL_MS = 30 * 24 * 60 * 60 * 1000;

const EMPTY_ATTRIBUTION: BookingAttribution = {
  marketing_source: null,
  marketing_medium: null,
  marketing_campaign: null,
  marketing_content: null,
  marketing_term: null,
  qr_code_slug: null,
  landing_url: null,
  referrer_url: null,
  gclid: null,
  gbraid: null,
  wbraid: null,
  captured_at: null,
};

function clean(value: unknown) {
  const v = String(value ?? "").trim();
  return v.length > 0 ? v : null;
}

function hasAnyAttribution(data: BookingAttribution) {
  return !!(
    data.marketing_source ||
    data.marketing_medium ||
    data.marketing_campaign ||
    data.marketing_content ||
    data.marketing_term ||
    data.qr_code_slug ||
    data.gclid ||
    data.gbraid ||
    data.wbraid
  );
}

function readStoredAttribution(now = Date.now()): BookingAttribution | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredAttribution;
    if (!parsed?.data || typeof parsed.expires_at !== "number") return null;
    if (parsed.expires_at < now) {
      window.localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return {
      ...EMPTY_ATTRIBUTION,
      ...parsed.data,
    };
  } catch {
    return null;
  }
}

function saveAttribution(data: BookingAttribution, now = Date.now()) {
  if (typeof window === "undefined") return;
  try {
    const payload: StoredAttribution = {
      data,
      expires_at: now + TTL_MS,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // ignore storage errors
  }
}

function fromSearchInput(search: AttributionSearchInput): BookingAttribution {
  return {
    marketing_source: clean(search.utm_source),
    marketing_medium: clean(search.utm_medium),
    marketing_campaign: clean(search.utm_campaign),
    marketing_content: clean(search.utm_content),
    marketing_term: clean(search.utm_term),
    qr_code_slug: clean(search.qr),
    gclid: clean(search.gclid),
    gbraid: clean(search.gbraid),
    wbraid: clean(search.wbraid),
    landing_url: typeof window !== "undefined" ? window.location.href : null,
    referrer_url:
      typeof document !== "undefined" && document.referrer ? document.referrer : null,
    captured_at: Date.now(),
  };
}

function fromUrlSearchParams(params: URLSearchParams): BookingAttribution {
  return fromSearchInput({
    utm_source: params.get("utm_source") ?? undefined,
    utm_medium: params.get("utm_medium") ?? undefined,
    utm_campaign: params.get("utm_campaign") ?? undefined,
    utm_content: params.get("utm_content") ?? undefined,
    utm_term: params.get("utm_term") ?? undefined,
    qr: params.get("qr") ?? undefined,
    gclid: params.get("gclid") ?? undefined,
    gbraid: params.get("gbraid") ?? undefined,
    wbraid: params.get("wbraid") ?? undefined,
  });
}

function mergeAttribution(
  stored: BookingAttribution | null,
  fromUrl: BookingAttribution,
  now: number,
): BookingAttribution {
  const base = stored ?? EMPTY_ATTRIBUTION;
  const urlHasParams = hasAnyAttribution(fromUrl);

  return {
    marketing_source: fromUrl.marketing_source ?? base.marketing_source,
    marketing_medium: fromUrl.marketing_medium ?? base.marketing_medium,
    marketing_campaign: fromUrl.marketing_campaign ?? base.marketing_campaign,
    marketing_content: fromUrl.marketing_content ?? base.marketing_content,
    marketing_term: fromUrl.marketing_term ?? base.marketing_term,
    qr_code_slug: fromUrl.qr_code_slug ?? base.qr_code_slug,
    gclid: fromUrl.gclid ?? base.gclid,
    gbraid: fromUrl.gbraid ?? base.gbraid,
    wbraid: fromUrl.wbraid ?? base.wbraid,
    landing_url: urlHasParams ? (fromUrl.landing_url ?? base.landing_url) : base.landing_url,
    referrer_url: urlHasParams ? (fromUrl.referrer_url ?? base.referrer_url) : base.referrer_url,
    captured_at: base.captured_at ?? (urlHasParams ? now : null),
  };
}

/** Read persisted attribution (client-only). */
export function getBookingAttribution(): BookingAttribution {
  if (typeof window === "undefined") return EMPTY_ATTRIBUTION;
  return readStoredAttribution() ?? EMPTY_ATTRIBUTION;
}

/**
 * Capture attribution from the current URL on any page. URL params override
 * stored values when present; first-touch landing/referrer are preserved unless
 * a new attributed landing occurs.
 */
export function syncAttributionFromWindow(now = Date.now()): BookingAttribution {
  if (typeof window === "undefined") return EMPTY_ATTRIBUTION;

  const fromUrl = fromUrlSearchParams(new URLSearchParams(window.location.search));
  const stored = readStoredAttribution(now);

  if (hasAnyAttribution(fromUrl)) {
    const merged = mergeAttribution(stored, fromUrl, now);
    if (!merged.captured_at) merged.captured_at = now;
    saveAttribution(merged, now);
    return merged;
  }

  if (stored) return stored;
  return EMPTY_ATTRIBUTION;
}

export function useBookingAttribution(search: AttributionSearchInput): BookingAttribution {
  const key = useMemo(
    () =>
      [
        search.utm_source,
        search.utm_medium,
        search.utm_campaign,
        search.utm_content,
        search.utm_term,
        search.qr,
        search.gclid,
        search.gbraid,
        search.wbraid,
      ].join("|"),
    [search],
  );
  const [attribution, setAttribution] = useState<BookingAttribution>(EMPTY_ATTRIBUTION);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const now = Date.now();
    const fromUrl = fromSearchInput(search);
    const stored = readStoredAttribution(now);

    if (hasAnyAttribution(fromUrl)) {
      const merged = mergeAttribution(stored, fromUrl, now);
      if (!merged.captured_at) merged.captured_at = now;
      saveAttribution(merged, now);
      setAttribution(merged);
      return;
    }

    setAttribution(stored ?? syncAttributionFromWindow(now));
  }, [key, search]);

  return attribution;
}
