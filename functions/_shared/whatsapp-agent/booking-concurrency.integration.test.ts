// Integration tests against a REAL Supabase project — never run these against production.
//
// Run with:
//   API_URL=https://<staging-project>.supabase.co \
//   SERVICE_ROLE_KEY=<staging-service-role-key> \
//   WHATSAPP_AGENT_ALLOW_INTEGRATION_TESTS=true \
//   deno test --allow-env --allow-net supabase/functions/_shared/whatsapp-agent/booking-concurrency.integration.test.ts
//
// Without WHATSAPP_AGENT_ALLOW_INTEGRATION_TESTS=true (and the two Supabase env vars), every test
// here is skipped — this file is safe to include in a default `deno test` run against any
// environment, including production, because it never runs unless explicitly opted into.
//
// Each test creates its own service + availability_slot + bookings rows and deletes them in a
// `finally` block, so a successful run leaves no residue. If a test is interrupted mid-run,
// re-run cleanup manually by deleting services with name starting with '__wa_agent_test_'.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { claimWebhookEventOnce } from "./state.ts";

const API_URL = Deno.env.get("API_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SERVICE_ROLE_KEY") ?? "";
const ALLOW =
  (Deno.env.get("WHATSAPP_AGENT_ALLOW_INTEGRATION_TESTS") ?? "").toLowerCase() === "true";
const canRun = ALLOW && !!API_URL && !!SERVICE_ROLE;

const admin = canRun
  ? createClient(API_URL, SERVICE_ROLE, { auth: { persistSession: false } })
  : null;

function uniqueSuffix() {
  return `${Deno.pid}_${Math.floor(performance.now() * 1000)}`;
}

async function withTestServiceAndSlot(
  fn: (ctx: { serviceId: string; date: string; time: string; capacity: number }) => Promise<void>,
  capacity = 1,
) {
  const suffix = uniqueSuffix();
  const name = `__wa_agent_test_service_${suffix}`;
  const date = "2099-01-01"; // far future — never collides with real operational dates
  const time = "09:00:00";

  const { data: service, error: svcErr } = await admin!
    .from("services")
    .insert({ name, base_price: 1000, duration_minutes: 30, active: true })
    .select("id")
    .single();
  if (svcErr || !service) throw new Error(`failed to create test service: ${svcErr?.message}`);

  const { error: slotErr } = await admin!.from("availability_slots").insert({
    date,
    start_time: time,
    end_time: "18:00:00",
    capacity,
    active: true,
  });
  if (slotErr) throw new Error(`failed to create test slot: ${slotErr.message}`);

  try {
    await fn({ serviceId: service.id, date, time: time.slice(0, 5), capacity });
  } finally {
    await admin!.from("bookings").delete().eq("service_id", service.id);
    await admin!.from("availability_slots").delete().eq("date", date).eq("start_time", time);
    await admin!.from("services").delete().eq("id", service.id);
  }
}

function bookingPayload(opts: {
  serviceId: string;
  date: string;
  time: string;
  phone: string;
  idempotencyKey?: string;
  durationMinutes?: number;
}) {
  const duration = opts.durationMinutes ?? 30;
  return {
    p_booking: {
      customer_name: "Test Customer",
      customer_phone: opts.phone,
      customer_email: null,
      address: "Falsa 123",
      neighborhood: "Centro",
      vehicle_type: "Auto",
      service_id: opts.serviceId,
      service_name: "__wa_agent_test_service",
      scheduled_date: opts.date,
      scheduled_time: `${opts.time}:00`,
      duration_minutes: duration,
      price: 1000,
      payment_method: "Pagar después",
      payment_status: "pending",
      booking_status: "confirmed",
      booking_source: "whatsapp_agent",
      vehicle_surcharge: 0,
      selected_extras: [],
      extras_total: 0,
      price_breakdown: {},
      vehicle_count: 1,
      subtotal_before_discounts: 1000,
      discount_total: 0,
    },
    p_units: [
      {
        unit_index: 1,
        vehicle_type: "Auto",
        service_id: opts.serviceId,
        service_name: "__wa_agent_test_service",
        selected_extras: [],
        service_price: 1000,
        vehicle_surcharge: 0,
        extras_total: 0,
        discount_rate: 0,
        discount_amount: 0,
        total_price: 1000,
        duration_minutes: duration,
        price_breakdown: {},
      },
    ],
    p_idempotency_key: opts.idempotencyKey ?? null,
  };
}

Deno.test({
  name: "claimWebhookEventOnce: first delivery succeeds, replay is rejected",
  ignore: !canRun,
  fn: async () => {
    const externalMessageId = `test_${uniqueSuffix()}`;
    const first = await claimWebhookEventOnce(admin!, {
      provider: "test",
      externalMessageId,
      customerPhone: "5491100000000",
    });
    const second = await claimWebhookEventOnce(admin!, {
      provider: "test",
      externalMessageId,
      customerPhone: "5491100000000",
    });
    assertEquals(first, true);
    assertEquals(second, false);
    await admin!
      .from("whatsapp_agent_processed_events")
      .delete()
      .eq("external_message_id", externalMessageId);
  },
});

Deno.test({
  name: "create_booking_atomic: replaying the same idempotency_key returns the original booking, not a new one",
  ignore: !canRun,
  fn: async () => {
    await withTestServiceAndSlot(async ({ serviceId, date, time }) => {
      const key = `test_idem_${uniqueSuffix()}`;
      const payload = bookingPayload({
        serviceId,
        date,
        time,
        phone: "5491100000001",
        idempotencyKey: key,
      });

      const { data: first, error: err1 } = await admin!.rpc("create_booking_atomic", payload);
      if (err1) throw err1;
      const { data: second, error: err2 } = await admin!.rpc("create_booking_atomic", payload);
      if (err2) throw err2;

      assertEquals(first.ok, true);
      assertEquals(second.ok, true);
      assertEquals(second.already_existed, true);
      assertEquals(first.booking_id, second.booking_id);

      const { count } = await admin!
        .from("bookings")
        .select("id", { count: "exact", head: true })
        .eq("service_id", serviceId);
      assertEquals(count, 1, "a replayed idempotency key must not create a second row");
    });
  },
});

Deno.test({
  name: "create_booking_atomic: N concurrent requests for a 1-capacity slot — exactly one succeeds",
  ignore: !canRun,
  fn: async () => {
    await withTestServiceAndSlot(async ({ serviceId, date, time }) => {
      const attempts = 5;
      const results = await Promise.all(
        Array.from({ length: attempts }, (_, i) =>
          admin!.rpc(
            "create_booking_atomic",
            bookingPayload({
              serviceId,
              date,
              time,
              phone: `549110000000${i}`,
              idempotencyKey: `test_conc_${uniqueSuffix()}_${i}`,
            }),
          ),
        ),
      );

      const outcomes = results.map((r) => r.data);
      const succeeded = outcomes.filter((o) => o?.ok === true);
      const full = outcomes.filter((o) => o?.ok === false && o?.reason === "slot_full");

      assertEquals(
        succeeded.length,
        1,
        `expected exactly 1 success out of ${attempts} concurrent attempts, got ${succeeded.length}`,
      );
      assertEquals(full.length, attempts - 1);

      const { count } = await admin!
        .from("bookings")
        .select("id", { count: "exact", head: true })
        .eq("service_id", serviceId)
        .neq("booking_status", "cancelled");
      assert(
        count === 1,
        `capacity=1 slot must never end up with more than 1 active booking, got ${count}`,
      );
    }, 1);
  },
});

Deno.test({
  name: "create_booking_atomic: overlapping durations at DIFFERENT start times still serialize (advisory-lock granularity fix)",
  ignore: !canRun,
  fn: async () => {
    // Regression test for a real bug found during review: locking on (date, start_time) instead
    // of just date would let a 90-minute 10:00 booking and a 60-minute 11:00 booking (which
    // overlap between 11:00-11:30) race each other, since they'd hash to different lock keys.
    const suffix = uniqueSuffix();
    const name = `__wa_agent_test_service_${suffix}`;
    const date = "2099-01-02";

    const { data: service, error: svcErr } = await admin!
      .from("services")
      .insert({ name, base_price: 1000, duration_minutes: 30, active: true })
      .select("id")
      .single();
    if (svcErr || !service) throw new Error(`failed to create test service: ${svcErr?.message}`);

    // Two slots, capacity 1 each — but the actual contention is on overlapping TIME, not on
    // slot identity, which is exactly what create_booking_atomic's overlap query (not the slot
    // row itself) is responsible for catching.
    await admin!.from("availability_slots").insert([
      { date, start_time: "10:00:00", end_time: "18:00:00", capacity: 1, active: true },
      { date, start_time: "11:00:00", end_time: "18:00:00", capacity: 1, active: true },
    ]);

    try {
      const [a, b] = await Promise.all([
        admin!.rpc(
          "create_booking_atomic",
          bookingPayload({
            serviceId: service.id,
            date,
            time: "10:00",
            phone: "5491100001001",
            durationMinutes: 90, // occupies 10:00-11:30
            idempotencyKey: `test_overlap_a_${suffix}`,
          }),
        ),
        admin!.rpc(
          "create_booking_atomic",
          bookingPayload({
            serviceId: service.id,
            date,
            time: "11:00",
            phone: "5491100001002",
            durationMinutes: 60, // occupies 11:00-12:00 — overlaps the first booking
            idempotencyKey: `test_overlap_b_${suffix}`,
          }),
        ),
      ]);

      const outcomes = [a.data, b.data];
      const succeeded = outcomes.filter((o) => o?.ok === true);
      assertEquals(
        succeeded.length,
        1,
        `two overlapping bookings at different start times must not both succeed, got ${JSON.stringify(outcomes)}`,
      );

      const { count } = await admin!
        .from("bookings")
        .select("id", { count: "exact", head: true })
        .eq("service_id", service.id)
        .neq("booking_status", "cancelled");
      assertEquals(count, 1);
    } finally {
      await admin!.from("bookings").delete().eq("service_id", service.id);
      await admin!.from("availability_slots").delete().eq("date", date);
      await admin!.from("services").delete().eq("id", service.id);
    }
  },
});
