/**
 * Google Ads (gtag.js) integration for the WASHERO SPA.
 *
 * Disabled when VITE_GOOGLE_ADS_ID is unset — all exports no-op safely on server
 * and when env vars are missing.
 *
 * Enhanced conversions: call setEnhancedConversionUserData before conversion
 * events when email/phone are available. gtag hashes values automatically when
 * "allow_enhanced_conversions" is enabled in the Google Ads tag settings.
 */

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

const GOOGLE_ADS_ID = String(import.meta.env.VITE_GOOGLE_ADS_ID ?? "").trim();
const BOOKING_CONVERSION_LABEL = String(
  import.meta.env.VITE_GOOGLE_ADS_BOOKING_CONVERSION_LABEL ?? "",
).trim();
const PAYMENT_CONVERSION_LABEL = String(
  import.meta.env.VITE_GOOGLE_ADS_PAYMENT_CONVERSION_LABEL ?? "",
).trim();

const SCRIPT_ID = "washero-google-ads-gtag";
const GTAG_REDIRECT_TIMEOUT_MS = 500;

export const LAST_BOOKING_KEY = "washero:last-booking";
const DEDUPE_PREFIX = "washero:ads:conv:";

let initPromise: Promise<void> | null = null;

function devLog(message: string, extra?: Record<string, unknown>) {
  if (!import.meta.env.DEV) return;
  if (extra) {
    console.debug(`[google-ads] ${message}`, extra);
  } else {
    console.debug(`[google-ads] ${message}`);
  }
}

export function isGoogleAdsEnabled(): boolean {
  return GOOGLE_ADS_ID.length > 0;
}

export function isBookingConversionConfigured(): boolean {
  return isGoogleAdsEnabled() && BOOKING_CONVERSION_LABEL.length > 0;
}

export function isPaymentConversionConfigured(): boolean {
  return isGoogleAdsEnabled() && PAYMENT_CONVERSION_LABEL.length > 0;
}

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

function gtag(...args: unknown[]) {
  if (!isBrowser()) return;
  window.gtag?.(...args);
}

function conversionDedupeKey(kind: "booking" | "payment", transactionId: string) {
  return `${DEDUPE_PREFIX}${kind}:${transactionId}`;
}

function hasFiredConversion(kind: "booking" | "payment", transactionId: string): boolean {
  if (!isBrowser() || !transactionId) return false;
  try {
    return localStorage.getItem(conversionDedupeKey(kind, transactionId)) === "1";
  } catch {
    return false;
  }
}

function markConversionFired(kind: "booking" | "payment", transactionId: string) {
  if (!isBrowser() || !transactionId) return;
  try {
    localStorage.setItem(conversionDedupeKey(kind, transactionId), "1");
  } catch {
    // ignore
  }
}

/**
 * Normalize phone for enhanced conversions (E.164-ish). Conservative: only
 * formats obvious AR mobile numbers; otherwise passes trimmed digits with +.
 */
export function normalizePhoneForEnhancedConversion(raw: string | null | undefined): string | null {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (digits.length < 8) return null;
  if (digits.startsWith("549") && digits.length >= 12) return `+${digits}`;
  if (digits.startsWith("54") && digits.length >= 11) return `+${digits}`;
  if (digits.startsWith("9") && digits.length === 10) return `+54${digits}`;
  if (digits.length >= 10) return `+${digits}`;
  return null;
}

/** Set first-party user_data for enhanced conversions (never logs values). */
export function setEnhancedConversionUserData(input: {
  email?: string | null;
  phone_number?: string | null;
}) {
  if (!isGoogleAdsEnabled() || !isBrowser()) return;

  const userData: Record<string, string> = {};
  const email = String(input.email ?? "").trim().toLowerCase();
  if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    userData.email = email;
  }
  const phone = normalizePhoneForEnhancedConversion(input.phone_number);
  if (phone) userData.phone_number = phone;

  if (Object.keys(userData).length === 0) return;
  gtag("set", "user_data", userData);
}

export function initGoogleAds(): Promise<void> {
  if (!isGoogleAdsEnabled() || !isBrowser()) return Promise.resolve();
  if (initPromise) return initPromise;

  initPromise = new Promise((resolve) => {
    window.dataLayer = window.dataLayer ?? [];
    window.gtag = function gtagFn(...args: unknown[]) {
      window.dataLayer!.push(args);
    };
    window.gtag("js", new Date());
    window.gtag("config", GOOGLE_ADS_ID, { send_page_view: false });

    if (document.getElementById(SCRIPT_ID)) {
      resolve();
      return;
    }

    const script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GOOGLE_ADS_ID)}`;
    script.onload = () => resolve();
    script.onerror = () => resolve();
    document.head.appendChild(script);
  });

  return initPromise;
}

export type GoogleAdsEventParams = Record<string, string | number | boolean | undefined>;

export function trackGoogleAdsEvent(eventName: string, params?: GoogleAdsEventParams) {
  if (!isGoogleAdsEnabled() || !isBrowser()) return;
  void initGoogleAds().then(() => {
    gtag("event", eventName, params ?? {});
  });
}

export function trackGoogleAdsPageView(input: {
  page_path: string;
  page_location: string;
  page_title?: string;
}) {
  if (!isGoogleAdsEnabled() || !isBrowser()) return;
  void initGoogleAds().then(() => {
    gtag("event", "page_view", {
      page_path: input.page_path,
      page_location: input.page_location,
      page_title: input.page_title ?? document.title,
      send_to: GOOGLE_ADS_ID,
    });
  });
}

function fireConversion(input: {
  sendTo: string;
  value?: number;
  transactionId: string;
  dedupeKind: "booking" | "payment";
}): Promise<void> {
  if (!isBrowser()) return Promise.resolve();
  if (hasFiredConversion(input.dedupeKind, input.transactionId)) {
    return Promise.resolve();
  }

  return initGoogleAds().then(
    () =>
      new Promise((resolve) => {
        let resolved = false;
        const resolveOnce = () => {
          if (resolved) return;
          resolved = true;
          resolve();
        };

        const timer = window.setTimeout(resolveOnce, GTAG_REDIRECT_TIMEOUT_MS);

        const conversionParams: Record<string, unknown> = {
          send_to: input.sendTo,
          currency: "ARS",
          transaction_id: input.transactionId,
          event_callback: () => {
            window.clearTimeout(timer);
            devLog("event_callback received", {
              dedupeKind: input.dedupeKind,
              transactionId: input.transactionId,
              send_to: input.sendTo,
            });
            markConversionFired(input.dedupeKind, input.transactionId);
            resolveOnce();
          },
        };
        if (typeof input.value === "number" && Number.isFinite(input.value) && input.value > 0) {
          conversionParams.value = input.value;
        }

        gtag("event", "conversion", conversionParams);
      }),
  );
}

export async function trackBookingCreatedConversion(input: {
  bookingId: string;
  value?: number;
  email?: string | null;
  phone?: string | null;
}) {
  const sendTo = `${GOOGLE_ADS_ID}/${BOOKING_CONVERSION_LABEL}`;

  devLog("Google Ads enabled", { enabled: isGoogleAdsEnabled() });

  if (!isBookingConversionConfigured()) {
    devLog("skipped because missing env", {
      googleAdsId: GOOGLE_ADS_ID || "(unset)",
      bookingConversionLabel: BOOKING_CONVERSION_LABEL || "(unset)",
    });
    return;
  }

  if (!input.bookingId) {
    devLog("skipped because missing bookingId");
    return;
  }

  if (hasFiredConversion("booking", input.bookingId)) {
    devLog("skipped because already fired", { bookingId: input.bookingId });
    return;
  }

  devLog("booking conversion attempt", {
    send_to: sendTo,
    bookingId: input.bookingId,
    value: input.value,
  });

  setEnhancedConversionUserData({
    email: input.email,
    phone_number: input.phone,
  });

  trackGoogleAdsEvent("booking_created", {
    transaction_id: input.bookingId,
    value: input.value,
    currency: "ARS",
  });

  await fireConversion({
    sendTo,
    value: input.value,
    transactionId: input.bookingId,
    dedupeKind: "booking",
  });
}

export async function trackPaymentSuccessConversion(input: {
  bookingId: string;
  value?: number;
  email?: string | null;
  phone?: string | null;
}) {
  if (!isPaymentConversionConfigured() || !input.bookingId) return;
  if (hasFiredConversion("payment", input.bookingId)) return;

  setEnhancedConversionUserData({
    email: input.email,
    phone_number: input.phone,
  });

  trackGoogleAdsEvent("payment_success", {
    transaction_id: input.bookingId,
    value: input.value,
    currency: "ARS",
  });

  await fireConversion({
    sendTo: `${GOOGLE_ADS_ID}/${PAYMENT_CONVERSION_LABEL}`,
    value: input.value,
    transactionId: input.bookingId,
    dedupeKind: "payment",
  });
}

export function readLastBookingSummary(): Record<string, unknown> | null {
  if (!isBrowser()) return null;
  try {
    let raw = localStorage.getItem(LAST_BOOKING_KEY);
    if (!raw) {
      raw = sessionStorage.getItem(LAST_BOOKING_KEY);
      if (raw) {
        localStorage.setItem(LAST_BOOKING_KEY, raw);
        sessionStorage.removeItem(LAST_BOOKING_KEY);
      }
    }
    if (!raw) return null;
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function persistLastBookingSummary(summary: Record<string, unknown>) {
  if (!isBrowser()) return;
  try {
    localStorage.setItem(LAST_BOOKING_KEY, JSON.stringify(summary));
    sessionStorage.removeItem(LAST_BOOKING_KEY);
  } catch {
    // ignore
  }
}

export async function completeWebsiteBookingSuccess(input: {
  bookingId: string;
  summary: Record<string, unknown>;
  paymentMethod: string;
  customerEmail?: string | null;
  customerPhone?: string | null;
  checkoutUrl?: string | null;
  navigate: (opts: { to: string }) => void;
}) {
  const price =
    typeof input.summary.price === "number" && Number.isFinite(input.summary.price)
      ? input.summary.price
      : undefined;

  persistLastBookingSummary({
    ...input.summary,
    booking_id: input.bookingId,
    payment_method: input.paymentMethod,
    price: price ?? input.summary.price,
    currency: "ARS",
    created_at: new Date().toISOString(),
    source: "booking_created",
  });

  await trackBookingCreatedConversion({
    bookingId: input.bookingId,
    value: price,
    email: input.customerEmail,
    phone: input.customerPhone,
  });

  if (input.checkoutUrl) {
    window.location.assign(input.checkoutUrl);
    return;
  }
  input.navigate({ to: "/gracias" });
}
