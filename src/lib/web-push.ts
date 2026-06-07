import { supabase } from "@/integrations/supabase/client";

const VAPID_STORAGE_KEY = "washero_push_vapid_public_key";

export function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) {
    out[i] = raw.charCodeAt(i);
  }
  return out;
}

export function getWebPushPublicKey(): string | null {
  const raw = import.meta.env.VITE_WEB_PUSH_PUBLIC_KEY;
  const key = typeof raw === "string" ? raw.trim() : "";
  return key.length > 0 ? key : null;
}

export function isWebPushSupported(): boolean {
  if (typeof window === "undefined") return false;
  return (
    "Notification" in window &&
    "serviceWorker" in navigator &&
    "PushManager" in window
  );
}

export function hasServiceWorkerApi(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator;
}

export function hasPushManagerApi(): boolean {
  return typeof window !== "undefined" && "PushManager" in window;
}

export type PushSubscriptionRow = {
  id: string;
  endpoint: string;
};

export type PushDiagnostics = {
  serviceWorkerApi: boolean;
  pushManagerApi: boolean;
  notificationPermission: NotificationPermission | "unsupported";
  serviceWorkerRegistered: boolean;
  browserSubscription: boolean;
  supabaseSubscription: boolean;
  publicKeyConfigured: boolean;
};

export type PushFunctionResponse = {
  ok?: boolean;
  status?: string;
  sent?: number;
  sent_count?: number;
  failed_count?: number;
  skipped?: string;
  skipped_reason?: string;
  removed?: number;
};

export async function isServiceWorkerRegistered(): Promise<boolean> {
  if (!hasServiceWorkerApi()) return false;
  const registration = await navigator.serviceWorker.getRegistration("/");
  return registration != null;
}

export async function hasBrowserPushSubscription(): Promise<boolean> {
  if (!hasServiceWorkerApi() || !hasPushManagerApi()) return false;
  try {
    const registration = await navigator.serviceWorker.getRegistration("/");
    if (!registration) return false;
    const subscription = await registration.pushManager.getSubscription();
    return subscription != null;
  } catch {
    return false;
  }
}

export async function collectPushDiagnostics(userId: string): Promise<PushDiagnostics> {
  const permission: NotificationPermission | "unsupported" =
    typeof window !== "undefined" && "Notification" in window
      ? Notification.permission
      : "unsupported";

  let supabaseSubscription = false;
  if (userId) {
    try {
      const rows = await fetchUserPushSubscriptions(userId);
      supabaseSubscription = rows.length > 0;
    } catch {
      supabaseSubscription = false;
    }
  }

  return {
    serviceWorkerApi: hasServiceWorkerApi(),
    pushManagerApi: hasPushManagerApi(),
    notificationPermission: permission,
    serviceWorkerRegistered: await isServiceWorkerRegistered(),
    browserSubscription: await hasBrowserPushSubscription(),
    supabaseSubscription,
    publicKeyConfigured: !!getWebPushPublicKey(),
  };
}

/** Await service worker registration before push subscribe (avoids race on first activate). */
export async function ensureOperatorServiceWorkerRegistration(): Promise<ServiceWorkerRegistration> {
  if (!hasServiceWorkerApi()) {
    throw new Error("not_supported");
  }

  let registration = await navigator.serviceWorker.getRegistration("/");
  if (!registration) {
    registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  }

  await navigator.serviceWorker.ready;
  return registration;
}

export async function fetchUserPushSubscriptions(userId: string): Promise<PushSubscriptionRow[]> {
  const { data, error } = await supabase
    .from("notification_subscriptions")
    .select("id, endpoint")
    .eq("user_id", userId);
  if (error) throw error;
  return data ?? [];
}

async function invokeSendOperatorPush(body: Record<string, unknown>): Promise<PushFunctionResponse> {
  const { data, error } = await supabase.functions.invoke("send-operator-push", { body });
  const response = (data ?? {}) as PushFunctionResponse;

  if (response.ok) {
    return response;
  }

  throw new Error(response.status ?? error?.message ?? "push_failed");
}

export async function subscribeOperatorPush(userId: string): Promise<void> {
  const publicKey = getWebPushPublicKey();
  if (!publicKey) {
    throw new Error("missing_public_key");
  }
  if (!isWebPushSupported()) {
    throw new Error("not_supported");
  }

  const registration = await ensureOperatorServiceWorkerRegistration();

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error(permission === "denied" ? "permission_denied" : "permission_default");
  }

  const storedVapid = localStorage.getItem(VAPID_STORAGE_KEY);
  let subscription = await registration.pushManager.getSubscription();

  if (subscription && storedVapid && storedVapid !== publicKey) {
    await subscription.unsubscribe();
    subscription = null;
  }

  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
    localStorage.setItem(VAPID_STORAGE_KEY, publicKey);
  } else if (!storedVapid) {
    localStorage.setItem(VAPID_STORAGE_KEY, publicKey);
  }

  const json = subscription.toJSON();
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!json.endpoint || !p256dh || !auth) {
    throw new Error("invalid_subscription");
  }

  const { error } = await supabase.from("notification_subscriptions").upsert(
    {
      user_id: userId,
      endpoint: json.endpoint,
      p256dh,
      auth,
      user_agent: navigator.userAgent,
    },
    { onConflict: "user_id,endpoint" },
  );
  if (error) {
    if (error.code === "42501") {
      throw new Error("permission_denied_db");
    }
    throw new Error(error.message || "subscription_save_failed");
  }
}

export type OperatorTestPushResult = {
  sent_count: number;
  skipped_reason?: string;
  failed_count?: number;
};

export async function sendOperatorTestPush(): Promise<OperatorTestPushResult> {
  const response = await invokeSendOperatorPush({
    type: "test_self",
  });
  return {
    sent_count: response.sent_count ?? response.sent ?? 0,
    skipped_reason: response.skipped_reason ?? response.skipped,
    failed_count: response.failed_count ?? 0,
  };
}

export type OperatorAssignmentPushResult = {
  ok: boolean;
  sent_count: number;
  skipped_reason?: string;
  failed_count?: number;
};

/** Notify the assigned operator after admin assignment (requires admin auth). */
export async function notifyOperatorAssignmentPush(
  bookingId: string,
  operatorId: string,
): Promise<OperatorAssignmentPushResult> {
  const id = bookingId.trim();
  const staffId = operatorId.trim();
  if (!id || !staffId) {
    throw new Error("missing_assignment_target");
  }

  const response = await invokeSendOperatorPush({
    type: "assignment",
    booking_id: id,
    operator_id: staffId,
    force: true,
  });
  return {
    ok: true,
    sent_count: response.sent_count ?? response.sent ?? 0,
    skipped_reason: response.skipped_reason ?? response.skipped,
    failed_count: response.failed_count ?? 0,
  };
}
