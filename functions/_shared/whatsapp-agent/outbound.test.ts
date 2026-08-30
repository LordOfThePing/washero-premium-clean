// Run with: deno test --allow-env supabase/functions/_shared/whatsapp-agent/outbound.test.ts
//
// Unit tests for the pure delivery-outcome classification (production-hardening audit —
// "outbound delivery ambiguity"). Covers 4 of the 6 requested scenarios without a DB or network
// call; the other 2 ("retry after ambiguous delivery", "retry after confirmed delivery") need the
// ledger row's persisted state and live in outbound-delivery.integration.test.ts instead.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { classifySendResult, classifyTimeout } from "./outbound.ts";

Deno.test("scenario: provider success -> 'sent', never retried", () => {
  const result = classifySendResult({ ok: true, status: "sent" });
  assertEquals(result.dbStatus, "sent");
  assertEquals(result.outcome, "sent");
  assertEquals(result.error, null);
});

Deno.test(
  "scenario: definite provider rejection (real HTTP error status) -> 'failed', safe to retry",
  () => {
    const result = classifySendResult({
      ok: false,
      status: "failed",
      error: "botmaker_http_400",
      response: { status: 400 },
    });
    assertEquals(result.dbStatus, "retryable");
    assertEquals(result.outcome, "failed");
  },
);

Deno.test(
  "scenario: request never attempted (skipped: invalid phone/missing token) -> definite 'failed', not ambiguous",
  () => {
    const result = classifySendResult({ ok: false, status: "skipped", error: "invalid_phone" });
    assertEquals(result.dbStatus, "retryable");
    assertEquals(result.outcome, "failed");
  },
);

Deno.test("scenario: timeout before provider acceptance -> 'ambiguous', never auto-retried", () => {
  const result = classifyTimeout();
  assertEquals(result.dbStatus, "ambiguous");
  assertEquals(result.outcome, "ambiguous");
  assertEquals(result.error, "timeout_awaiting_response");
});

Deno.test(
  "scenario: provider acceptance followed by lost response (network error, no HTTP status) -> 'ambiguous'",
  () => {
    // This is what a dropped connection after Botmaker may have already processed the request
    // looks like from our side: ok:false, no response object (status 0/absent) — we genuinely
    // cannot tell whether Botmaker received it.
    const result = classifySendResult({
      ok: false,
      status: "failed",
      error: "network_error",
      response: null,
    });
    assertEquals(result.dbStatus, "ambiguous");
    assertEquals(result.outcome, "ambiguous");
  },
);

Deno.test(
  "scenario: network error WITH an explicit status:0 response object is still ambiguous, not failed",
  () => {
    const result = classifySendResult({
      ok: false,
      status: "failed",
      error: "network_error",
      response: { status: 0 },
    });
    assertEquals(result.dbStatus, "ambiguous");
    assertEquals(result.outcome, "ambiguous");
  },
);

Deno.test("a 5xx server error response is still a DEFINITE failure (Botmaker did respond)", () => {
  const result = classifySendResult({
    ok: false,
    status: "failed",
    error: "botmaker_http_503",
    response: { status: 503 },
  });
  assertEquals(result.dbStatus, "retryable");
  assertEquals(result.outcome, "failed");
});
