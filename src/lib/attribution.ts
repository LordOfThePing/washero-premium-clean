import { useEffect, useMemo, useState } from "react";

export type AttributionSearchInput = {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
  qr?: string;
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
    data.qr_code_slug
  );
}

function readStoredAttribution(now = Date.now()): BookingAttribution | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredAttribution;
    if (!parsed?.data || typeof parsed.expires_at !== "number") return null;
    if (parsed.expires_at < now) {
      window.localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

function saveAttribution(data: BookingAttribution, now = Date.now()) {
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

function fromSearch(search: AttributionSearchInput): BookingAttribution {
  const data: BookingAttribution = {
    marketing_source: clean(search.utm_source),
    marketing_medium: clean(search.utm_medium),
    marketing_campaign: clean(search.utm_campaign),
    marketing_content: clean(search.utm_content),
    marketing_term: clean(search.utm_term),
    qr_code_slug: clean(search.qr),
    landing_url: typeof window !== "undefined" ? window.location.href : null,
    referrer_url:
      typeof document !== "undefined" && document.referrer ? document.referrer : null,
  };
  return data;
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
      ].join("|"),
    [search],
  );
  const [attribution, setAttribution] = useState<BookingAttribution>(EMPTY_ATTRIBUTION);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const now = Date.now();
    const fromUrl = fromSearch(search);
    if (hasAnyAttribution(fromUrl)) {
      saveAttribution(fromUrl, now);
      setAttribution(fromUrl);
      return;
    }
    const stored = readStoredAttribution(now);
    setAttribution(stored ?? EMPTY_ATTRIBUTION);
  }, [key, search]);

  return attribution;
}
