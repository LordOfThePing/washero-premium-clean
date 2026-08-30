import { db } from "@/integrations/db/client";

export type CreateSubscriptionBookingPayload = {
  customer_subscription_id: string;
  service_id: string;
  scheduled_date: string;
  scheduled_time: string;
  address: string;
  neighborhood: string;
  vehicle_type: string;
  notes?: string | null;
  place_id?: string | null;
  formatted_address?: string | null;
  address_lat?: number | null;
  address_lng?: number | null;
};

export type CreateSubscriptionBookingResponse = {
  ok: boolean;
  status?: string;
  customer_message?: string;
  booking_id?: string;
  subscription_usage_id?: string;
  remaining_washes?: number;
};

export async function invokeCreateSubscriptionBooking(
  payload: CreateSubscriptionBookingPayload,
): Promise<CreateSubscriptionBookingResponse> {
  const { data, error } = await db.functions.invoke("create-subscription-booking", {
    body: payload,
  });
  if (error) {
    return { ok: false, status: "server_error", customer_message: error.message };
  }
  return (data ?? { ok: false, status: "server_error" }) as CreateSubscriptionBookingResponse;
}
