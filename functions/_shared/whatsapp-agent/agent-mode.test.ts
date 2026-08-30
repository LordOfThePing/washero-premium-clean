// Run with: deno test --allow-env supabase/functions/_shared/whatsapp-agent/agent-mode.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { getAgentMode, isDryRunMode, isPhoneEligibleForAgent } from "./agent-mode.ts";

function withEnv(vars: Record<string, string | undefined>, fn: () => void) {
  const prev: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    prev[k] = Deno.env.get(k);
    if (v === undefined) Deno.env.delete(k);
    else Deno.env.set(k, v);
  }
  try {
    fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) Deno.env.delete(k);
      else Deno.env.set(k, v);
    }
  }
}

Deno.test("getAgentMode defaults to disabled when unset", () => {
  withEnv({ WHATSAPP_AGENT_MODE: undefined }, () => {
    assertEquals(getAgentMode(), "disabled");
  });
});

Deno.test("getAgentMode falls back to disabled for an unrecognized value (fail closed)", () => {
  withEnv({ WHATSAPP_AGENT_MODE: "yolo" }, () => {
    assertEquals(getAgentMode(), "disabled");
  });
});

Deno.test("getAgentMode accepts all four documented modes, case-insensitively", () => {
  withEnv({ WHATSAPP_AGENT_MODE: "Shadow" }, () => assertEquals(getAgentMode(), "shadow"));
  withEnv({ WHATSAPP_AGENT_MODE: "CANARY" }, () => assertEquals(getAgentMode(), "canary"));
  withEnv({ WHATSAPP_AGENT_MODE: "active" }, () => assertEquals(getAgentMode(), "active"));
});

Deno.test("disabled mode: no phone is ever eligible, even if allowlisted", () => {
  withEnv({ WHATSAPP_AGENT_TEST_PHONES: "5491122334455" }, () => {
    assertEquals(isPhoneEligibleForAgent("5491122334455", "disabled"), false);
  });
});

Deno.test("shadow/canary mode: only allowlisted phones are eligible", () => {
  withEnv({ WHATSAPP_AGENT_TEST_PHONES: "5491122334455" }, () => {
    assertEquals(isPhoneEligibleForAgent("5491122334455", "shadow"), true);
    assertEquals(isPhoneEligibleForAgent("5491122334455", "canary"), true);
    assertEquals(isPhoneEligibleForAgent("5491199998888", "shadow"), false);
    assertEquals(isPhoneEligibleForAgent("5491199998888", "canary"), false);
  });
});

Deno.test("active mode: any valid phone is eligible regardless of the allowlist", () => {
  withEnv({ WHATSAPP_AGENT_TEST_PHONES: "" }, () => {
    assertEquals(isPhoneEligibleForAgent("5491199998888", "active"), true);
  });
});

Deno.test("active mode still rejects an unparseable phone", () => {
  assertEquals(isPhoneEligibleForAgent("not-a-phone", "active"), false);
  assertEquals(isPhoneEligibleForAgent(null, "active"), false);
});

Deno.test("only shadow mode is a dry run — canary and active send real messages", () => {
  assertEquals(isDryRunMode("shadow"), true);
  assertEquals(isDryRunMode("canary"), false);
  assertEquals(isDryRunMode("active"), false);
  assertEquals(isDryRunMode("disabled"), false);
});
