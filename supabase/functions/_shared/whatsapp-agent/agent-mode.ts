// Explicit WhatsApp agent rollout modes (production-hardening audit finding #4).
//
// The old "shadow mode" name was misleading — it actually sent real replies and created real
// bookings for allowlisted phones, which is a canary rollout, not a shadow run. Four distinct,
// unambiguous modes now exist so nobody can flip one env var and accidentally start replying to
// real customers.
import { normalizeArgentinaWhatsAppPhone } from "../botmaker-outbound.ts";

export type AgentMode = "disabled" | "shadow" | "canary" | "active";

const VALID_MODES: readonly AgentMode[] = ["disabled", "shadow", "canary", "active"];

export function getAgentMode(): AgentMode {
  const raw = (Deno.env.get("WHATSAPP_AGENT_MODE") ?? "disabled").trim().toLowerCase();
  return (VALID_MODES as readonly string[]).includes(raw) ? (raw as AgentMode) : "disabled";
}

function parseAllowlist(): Set<string> {
  const raw = Deno.env.get("WHATSAPP_AGENT_TEST_PHONES") ?? "";
  const set = new Set<string>();
  for (const entry of raw.split(",")) {
    const normalized = normalizeArgentinaWhatsAppPhone(entry.trim());
    if (normalized) set.add(normalized);
  }
  return set;
}

/** Whether this phone should be routed to the new agent at all, given the current mode. */
export function isPhoneEligibleForAgent(
  phone: string | null | undefined,
  mode: AgentMode = getAgentMode(),
): boolean {
  if (mode === "disabled") return false;
  if (mode === "active") return !!normalizeArgentinaWhatsAppPhone(phone);
  // shadow / canary: allowlist-gated
  const normalized = normalizeArgentinaWhatsAppPhone(phone);
  if (!normalized) return false;
  return parseAllowlist().has(normalized);
}

/** Shadow mode never sends a real message or mutates a booking — it only records what it would do. */
export function isDryRunMode(mode: AgentMode = getAgentMode()): boolean {
  return mode === "shadow";
}
