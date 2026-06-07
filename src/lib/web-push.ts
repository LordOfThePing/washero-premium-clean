import { supabase } from "@/integrations/supabase/client";
import { registerOperatorServiceWorker } from "@/lib/operator-pwa";

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

export type PushSubscriptionRow = {
  id: string;
  endpoint: string;
};

export async function fetchUserPushSubscriptions(userId: string): Promise<PushSubscriptionRow[]> {
  const { data, error } = await supabase
    .from("notification_subscriptions")
    .select("id, endpoint")
    .eq("user_id", userId);
  if (error) throw error;
  return data ?? [];
}

export async function subscribeOperatorPush(userId: string): Promise<void> {
  const publicKey = getWebPushPublicKey();
  if (!publicKey) {
    throw new Error("missing_public_key");
  }
  if (!isWebPushSupported()) {
    throw new Error("not_supported");
  }

  registerOperatorServiceWorker();

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error(permission === "denied" ? "permission_denied" : "permission_default");
  }

  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();

  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
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
  if (error) throw error;
}

export async function sendOperatorTestPush(): Promise<{ sent?: number }> {
  const { data, error } = await supabase.functions.invoke("send-operator-push", {
    body: {
      test: true,
      title: "Washero",
      body: "Notificaciones activadas correctamente.",
      url: "/operator/hoy",
      force: true,
    },
  });
  if (error) throw error;
  const body = data as { ok?: boolean; status?: string; sent?: number } | null;
  if (!body?.ok) {
    throw new Error(body?.status ?? "push_failed");
  }
  return { sent: body.sent };
}

export type OperatorAssignmentPushResult = {
  ok: boolean;
  sent_count: number;
  skipped_reason?: string;
};

/** Notify the assigned operator after admin assignment (requires admin auth). */
export async function notifyOperatorAssignmentPush(
  bookingId: string,
): Promise<OperatorAssignmentPushResult> {
  const { data, error } = await supabase.functions.invoke("send-operator-push", {
    body: {
      type: "assignment",
      booking_id: bookingId,
      force: true,
    },
  });
  if (error) {
    throw new Error(error.message);
  }
  const body = data as {
    ok?: boolean;
    status?: string;
    sent?: number;
    sent_count?: number;
    skipped?: string;
    skipped_reason?: string;
  } | null;
  if (!body?.ok) {
    throw new Error(body?.status ?? "push_failed");
  }
  return {
    ok: true,
    sent_count: body.sent_count ?? body.sent ?? 0,
    skipped_reason: body.skipped_reason ?? body.skipped,
  };
}
