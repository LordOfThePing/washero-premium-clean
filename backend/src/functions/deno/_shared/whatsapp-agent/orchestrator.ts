// @ts-nocheck -- ported verbatim from functions/; not our source of truth for types
// The Claude tool-use loop. This is the only place that talks to the Anthropic API — everything
// it can do is limited to the deterministic tools in tools.ts; it never touches Supabase directly.
//
// Execution limits (production-hardening audit finding #9): every external call has a timeout,
// every loop has a bound, and every uncertain/exhausted state resolves to human handoff instead
// of looping or guessing. This function never sends the customer a message itself — see
// job-processor.ts / outbound.ts, which own delivery and its idempotency separately from turn
// generation, so a retry of a failed *send* doesn't have to re-run the whole turn.
//
// Lease awareness (second-pass correctness fix): a long turn can span many awaited I/O calls,
// during which another worker could legitimately reclaim this job's lease if this worker goes
// silent (crash, recycle). `lease` is checked before every mutating tool call — if the lease was
// lost, the turn aborts immediately without calling the tool and without producing a reply for
// job-processor.ts to send (see requirements: "a worker that loses its lease must stop before
// executing further mutating tools or sending an outbound message").
//
// Safe tool execution ordering (third-pass correctness fix): the model's own stated intentions
// are never trusted for concurrency safety — see planToolExecution/runToolPlan below, which
// derive execution grouping purely from each tool's registered `kind` (tools.ts), not from the
// model's tool-call order or count.
import type { SupabaseClient } from "@supabase/supabase-js";
import { AGENT_TOOLS, findTool, getToolKind, type AgentToolContext } from "./tools.ts";
import { buildSystemPrompt } from "./system-prompt.ts";
import {
  appendMessage,
  loadRecentMessages,
  toClaudeMessages,
  updateConversation,
  type AgentConversationRow,
} from "./state.ts";
import { cleanupPriorAttemptMessages } from "./job-queue.ts";
import { requestHumanHandoff } from "./handoff.ts";
import type { LeaseView } from "./job-lease.ts";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_MODEL = "claude-sonnet-5";

const MAX_TOOL_ITERATIONS = 6;
const MAX_TOOL_CALLS_PER_ITERATION = 5; // defensive fan-out cap, applied before planning
const MAX_CONSECUTIVE_TOOL_FAILURES = 2;
const ANTHROPIC_REQUEST_TIMEOUT_MS = 30_000;
const ANTHROPIC_RETRY_SLEEP_MS = 1_000; // one retry, only for 429/5xx — not for 4xx client errors
const TOOL_EXECUTION_TIMEOUT_MS = 15_000;
const MAX_HISTORY_MESSAGES = 60;
const MAX_HISTORY_CHARS = 60_000; // rough token-budget guard, oldest-first trimmed
const MAX_INBOUND_MESSAGE_CHARS = 4000; // WhatsApp's own text limit is ~4096
const MISC_DB_OVERHEAD_ESTIMATE_MS = 10_000; // generous allowance for appendMessage/loadRecentMessages/etc, none individually timed
const OUTBOUND_SEND_TIMEOUT_MS = 20_000; // see outbound.ts — happens once, after the turn, not per iteration

/**
 * Documented worst-case turn duration (informational/monitoring only — NOT used to gate the job
 * lease, which is renewal-based and therefore decoupled from total duration; see job-lease.ts).
 * Derivation:
 *   per-iteration Anthropic worst case = ANTHROPIC_REQUEST_TIMEOUT_MS (first attempt times out or
 *     fails) + ANTHROPIC_RETRY_SLEEP_MS + ANTHROPIC_REQUEST_TIMEOUT_MS (retry, only reached for
 *     429/5xx) = 30_000 + 1_000 + 30_000 = 61_000ms
 *   per-iteration tool-call worst case: safe tool execution ordering (planToolExecution/
 *     runToolPlan) means a mutation never runs concurrently with a read, which costs latency —
 *     the worst case is 3 sequential phases (reads-before-mutation, the mutation alone,
 *     reads-after-mutation), each up to TOOL_EXECUTION_TIMEOUT_MS = 3 * 15_000 = 45_000ms. (The
 *     alternative worst case — a handoff_control call alone, then reads — is only 2 phases /
 *     30_000ms, so it's not the binding constraint.)
 *   per-iteration total = 61_000 + 45_000 = 106_000ms, times MAX_TOOL_ITERATIONS (6) = 636_000ms
 *   + MISC_DB_OVERHEAD_ESTIMATE_MS (10_000) + OUTBOUND_SEND_TIMEOUT_MS (20_000, once, after the
 *     loop) = 666_000ms ≈ 11.1 minutes
 */
export const MAX_TURN_DURATION_ESTIMATE_MS =
  MAX_TOOL_ITERATIONS *
    (ANTHROPIC_REQUEST_TIMEOUT_MS +
      ANTHROPIC_RETRY_SLEEP_MS +
      ANTHROPIC_REQUEST_TIMEOUT_MS +
      3 * TOOL_EXECUTION_TIMEOUT_MS) +
  MISC_DB_OVERHEAD_ESTIMATE_MS +
  OUTBOUND_SEND_TIMEOUT_MS;

export type TextBlock = { type: "text"; text: string };
export type ToolUseBlock = {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
};
export type ToolResultBlock = {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
};
type ClaudeContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;
type ClaudeMessage = { role: "user" | "assistant"; content: string | ClaudeContentBlock[] };
type ClaudeResponse = { content: ClaudeContentBlock[]; stop_reason: string; role: "assistant" };

function isTextBlock(b: ClaudeContentBlock): b is TextBlock {
  return b.type === "text";
}
function isToolUseBlock(b: ClaudeContentBlock): b is ToolUseBlock {
  return b.type === "tool_use";
}

function toolsForApi() {
  return AGENT_TOOLS.map(({ name, description, input_schema }) => ({
    name,
    description,
    input_schema,
  }));
}

// ---------------------------------------------------------------------------
// Safe tool execution ordering (production-hardening audit — "safe tool execution ordering").
// Pure/DB-free so it's directly unit-testable — see orchestrator-tool-planning.test.ts.
// ---------------------------------------------------------------------------

export type ToolPlanAction = "execute_handoff" | "execute_read" | "execute_mutation" | "reject";
export type ToolPlanEntry = { block: ToolUseBlock; action: ToolPlanAction; rejectReason?: string };

/**
 * Decides, for one Claude iteration's tool_use blocks, which execute and how they're grouped.
 * Never relies on the model's own ordering, count, or stated intent for safety — only on each
 * tool's registered `kind` (tools.ts) and the rules below. Malformed input / unknown tool names
 * are rejected before classification.
 *
 * Rules:
 *  - at most one 'mutation' survives per iteration (first by position); every other mutation call
 *    in the same response is rejected, never executed, never queued for later;
 *  - if a handoff_control call is present in this response, OR handoff was already triggered in
 *    an earlier iteration of this same turn, every mutation in this response is rejected —
 *    regardless of the mutation's position relative to the handoff call;
 *  - request_human_handoff always gets its own deterministic action (execute_handoff), never
 *    folded into a batch with anything else.
 */
export function planToolExecution(
  blocks: ToolUseBlock[],
  opts: { handoffAlreadyTriggered: boolean },
): ToolPlanEntry[] {
  const classified = blocks.map((block) => {
    if (typeof block.input !== "object" || block.input === null || Array.isArray(block.input)) {
      return { block, kind: null as ReturnType<typeof getToolKind>, malformed: true };
    }
    return { block, kind: getToolKind(block.name), malformed: false };
  });

  const hasHandoffHere = classified.some((c) => c.kind === "handoff_control");
  const mutationsBlocked = opts.handoffAlreadyTriggered || hasHandoffHere;
  const firstMutationIndex = classified.findIndex((c) => c.kind === "mutation");

  return classified.map((c, i): ToolPlanEntry => {
    if (c.malformed)
      return { block: c.block, action: "reject", rejectReason: "malformed_tool_input" };
    if (c.kind === null) return { block: c.block, action: "reject", rejectReason: "unknown_tool" };
    if (c.kind === "handoff_control") return { block: c.block, action: "execute_handoff" };
    if (c.kind === "mutation") {
      if (mutationsBlocked) {
        return {
          block: c.block,
          action: "reject",
          rejectReason: opts.handoffAlreadyTriggered
            ? "handoff_already_triggered_this_turn"
            : "handoff_triggered_in_same_response",
        };
      }
      if (i !== firstMutationIndex) {
        return { block: c.block, action: "reject", rejectReason: "multiple_mutations_in_one_turn" };
      }
      return { block: c.block, action: "execute_mutation" };
    }
    return { block: c.block, action: "execute_read" };
  });
}

/**
 * Runs a plan in phases so a mutation never executes concurrently with a read that could affect
 * it, or be affected by it: handoff_control (alone) -> reads positioned before the surviving
 * mutation (parallel) -> the mutation (alone) -> reads positioned after it (parallel). Rejected
 * entries never call `executor` at all. Preserves the model-provided order of reads relative to
 * the mutation (reads before it run before; reads after it run after).
 */
export async function runToolPlan(
  plan: ToolPlanEntry[],
  executor: (block: ToolUseBlock) => Promise<Record<string, unknown>>,
): Promise<Map<string, Record<string, unknown>>> {
  const results = new Map<string, Record<string, unknown>>();

  for (const entry of plan) {
    if (entry.action === "reject") {
      results.set(entry.block.id, { ok: false, error: entry.rejectReason ?? "rejected" });
    }
  }

  for (const entry of plan) {
    if (entry.action === "execute_handoff") {
      results.set(entry.block.id, await executor(entry.block));
    }
  }

  const mutationIndex = plan.findIndex((e) => e.action === "execute_mutation");
  const readsBefore = (mutationIndex === -1 ? plan : plan.slice(0, mutationIndex)).filter(
    (e) => e.action === "execute_read",
  );
  const readsAfter =
    mutationIndex === -1
      ? []
      : plan.slice(mutationIndex + 1).filter((e) => e.action === "execute_read");

  if (readsBefore.length > 0) {
    const outputs = await Promise.all(readsBefore.map((e) => executor(e.block)));
    readsBefore.forEach((e, i) => results.set(e.block.id, outputs[i]));
  }

  if (mutationIndex !== -1) {
    const entry = plan[mutationIndex];
    results.set(entry.block.id, await executor(entry.block));
  }

  if (readsAfter.length > 0) {
    const outputs = await Promise.all(readsAfter.map((e) => executor(e.block)));
    readsAfter.forEach((e, i) => results.set(e.block.id, outputs[i]));
  }

  return results;
}

class AnthropicHttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callClaudeOnce(messages: ClaudeMessage[], system: string): Promise<ClaudeResponse> {
  const apiKey = process.env.ANTHROPIC_API_KEY ?? "";
  if (!apiKey) throw new Error("missing_anthropic_api_key");
  const model = process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ANTHROPIC_REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({ model, max_tokens: 1024, system, messages, tools: toolsForApi() }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new AnthropicHttpError(
        res.status,
        `anthropic_http_${res.status}: ${text.slice(0, 500)}`,
      );
    }
    return (await res.json()) as ClaudeResponse;
  } finally {
    clearTimeout(timeoutId);
  }
}

/** One retry, only for rate limits (429) and server errors (5xx) — never for 4xx client errors. */
async function callClaude(messages: ClaudeMessage[], system: string): Promise<ClaudeResponse> {
  try {
    return await callClaudeOnce(messages, system);
  } catch (e) {
    const retryable = e instanceof AnthropicHttpError && (e.status === 429 || e.status >= 500);
    if (!retryable) throw e;
    console.warn("[whatsapp-agent/orchestrator] anthropic call failed, retrying once", {
      status: (e as AnthropicHttpError).status,
    });
    await sleep(ANTHROPIC_RETRY_SLEEP_MS);
    return await callClaudeOnce(messages, system);
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label}_timeout`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timeoutId);
  }
}

function extractText(content: ClaudeContentBlock[]): string {
  return content
    .filter(isTextBlock)
    .map((b) => b.text)
    .join("\n")
    .trim();
}

/** Oldest-first trim to a message-count and character budget — never send unbounded history. */
function boundHistory(messages: ClaudeMessage[]): ClaudeMessage[] {
  const bounded = messages.slice(-MAX_HISTORY_MESSAGES);
  let totalChars = bounded.reduce((sum, m) => sum + JSON.stringify(m.content).length, 0);
  while (totalChars > MAX_HISTORY_CHARS && bounded.length > 1) {
    const dropped = bounded.shift()!;
    totalChars -= JSON.stringify(dropped.content).length;
  }
  return bounded;
}

async function sendFallback(
  admin: SupabaseClient,
  conversation: AgentConversationRow,
  jobId: string,
  text: string,
): Promise<void> {
  await appendMessage(admin, conversation.id, {
    role: "assistant",
    content: text,
    raw_content: [{ type: "text", text }],
    job_id: jobId,
  });
}

/** Executes one tool call, honoring the lease gate for mutating tools (getToolKind-based, not a
 * name allowlist, so a new tool automatically inherits the right gating from its declared kind). */
async function executeOneTool(
  admin: SupabaseClient,
  block: ToolUseBlock,
  ctx: AgentToolContext,
  lease: LeaseView | undefined,
): Promise<Record<string, unknown>> {
  const tool = findTool(block.name);
  if (!tool) return { ok: false, error: "unknown_tool" };
  if (typeof block.input !== "object" || block.input === null || Array.isArray(block.input)) {
    return { ok: false, error: "malformed_tool_input" };
  }
  if (getToolKind(block.name) === "mutation" && lease && !lease.isValid()) {
    console.warn("[whatsapp-agent/orchestrator] lease lost — refusing to execute mutating tool", {
      tool: block.name,
    });
    return { ok: false, error: "lease_lost" };
  }
  try {
    return await withTimeout(
      tool.execute(admin, block.input, ctx),
      TOOL_EXECUTION_TIMEOUT_MS,
      `tool_${block.name}`,
    );
  } catch (e) {
    console.error("[whatsapp-agent/orchestrator] tool execution failed", block.name, e);
    const message = String((e as Error)?.message ?? e);
    return { ok: false, error: message.endsWith("_timeout") ? "tool_timeout" : "tool_exception" };
  }
}

export type AgentTurnResult = {
  replyText: string | null;
  handoffRequested: boolean;
  bookingId: string | null;
  error: string | null;
  /** true when the turn aborted because another worker reclaimed this job's lease mid-run —
   * job-processor.ts MUST NOT send replyText (there usually isn't one) or mark the job in this case. */
  leaseLost: boolean;
};

export async function runAgentTurn(
  admin: SupabaseClient,
  conversation: AgentConversationRow,
  input: {
    userText: string;
    externalMessageId?: string | null;
    jobId: string;
    dryRun: boolean;
    lease?: LeaseView;
  },
): Promise<AgentTurnResult> {
  // A retry of this exact job must not replay a half-finished attempt's dangling tool_use block
  // with no matching tool_result — clear anything this job wrote before, then start clean.
  await cleanupPriorAttemptMessages(admin, input.jobId);

  const truncatedUserText =
    input.userText.length > MAX_INBOUND_MESSAGE_CHARS
      ? `${input.userText.slice(0, MAX_INBOUND_MESSAGE_CHARS)}… [mensaje truncado]`
      : input.userText;

  await appendMessage(admin, conversation.id, {
    role: "user",
    content: truncatedUserText,
    raw_content: truncatedUserText,
    external_message_id: input.externalMessageId ?? null,
    job_id: input.jobId,
  });

  // raw_content is jsonb (unknown to state.ts) but is only ever written by this file, always as
  // either a plain string or a ClaudeContentBlock[] — safe to assert back to ClaudeMessage here.
  const rawHistory = toClaudeMessages(await loadRecentMessages(admin, conversation.id, 200));
  const history = boundHistory(rawHistory as unknown as ClaudeMessage[]);
  const system = buildSystemPrompt({
    customerName: conversation.customer_name,
    isTest: conversation.is_test,
  });
  const ctx: AgentToolContext = {
    conversationId: conversation.id,
    customerPhone: conversation.customer_phone,
    isTest: conversation.is_test,
    dryRun: input.dryRun,
  };

  const messages: ClaudeMessage[] = [...history];
  let handoffRequested = false;
  let handoffReason = "";
  let bookingId: string | null = null;
  let consecutiveToolFailures = 0;

  try {
    for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
      if (input.lease && !input.lease.isValid()) {
        console.warn(
          "[whatsapp-agent/orchestrator] lease lost before iteration started, aborting turn",
          {
            job_id: input.jobId,
            iteration,
          },
        );
        return {
          replyText: null,
          handoffRequested,
          bookingId,
          error: "lease_lost",
          leaseLost: true,
        };
      }

      const response = await callClaude(messages, system);
      messages.push({ role: "assistant", content: response.content });
      await appendMessage(admin, conversation.id, {
        role: "assistant",
        content: extractText(response.content) || null,
        raw_content: response.content,
        job_id: input.jobId,
      });

      const toolUseBlocks = response.content.filter(isToolUseBlock);

      if (response.stop_reason !== "tool_use" || toolUseBlocks.length === 0) {
        if (input.lease && !input.lease.isValid()) {
          return {
            replyText: null,
            handoffRequested,
            bookingId,
            error: "lease_lost",
            leaseLost: true,
          };
        }
        if (handoffRequested) {
          await requestHumanHandoff(
            admin,
            conversation,
            handoffReason || "El agente derivó la conversación.",
          );
        }
        if (bookingId) await updateConversation(admin, conversation.id, { booking_id: bookingId });
        return {
          replyText: extractText(response.content) || null,
          handoffRequested,
          bookingId,
          error: null,
          leaseLost: false,
        };
      }

      // Excess tool_use blocks beyond the cap still need a tool_result each (Claude's contract
      // requires one per tool_use_id) — reject them deterministically rather than silently drop.
      const acceptedBlocks = toolUseBlocks.slice(0, MAX_TOOL_CALLS_PER_ITERATION);
      const overflowBlocks = toolUseBlocks.slice(MAX_TOOL_CALLS_PER_ITERATION);

      const plan = planToolExecution(acceptedBlocks, { handoffAlreadyTriggered: handoffRequested });
      const planResults = await runToolPlan(plan, (block) =>
        executeOneTool(admin, block, ctx, input.lease),
      );

      const toolResults: ToolResultBlock[] = [];
      for (const entry of plan) {
        const block = entry.block;
        const output = planResults.get(block.id) ?? { ok: false, error: "internal_plan_error" };

        consecutiveToolFailures = output.ok === false ? consecutiveToolFailures + 1 : 0;

        if (entry.action === "execute_handoff" && output.ok !== false) {
          handoffRequested = true;
          handoffReason = String(output.reason ?? "El cliente pidió hablar con una persona.");
        }
        if (
          entry.action === "execute_mutation" &&
          block.name === "create_booking" &&
          output.ok === true &&
          !output.dry_run
        ) {
          const booking = output.booking as { id?: string } | undefined;
          if (booking?.id) bookingId = booking.id;
        }

        await appendMessage(admin, conversation.id, {
          role: "tool",
          tool_name: block.name,
          tool_input: block.input,
          tool_output: output,
          content: `${block.name} -> ${output.ok === false ? `error: ${String(output.error ?? output.reason ?? "")}` : "ok"}`,
          job_id: input.jobId,
        });

        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify(output),
          is_error: output.ok === false,
        });
      }
      for (const block of overflowBlocks) {
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify({ ok: false, error: "too_many_tool_calls_in_one_turn" }),
          is_error: true,
        });
      }

      const attemptedMutation = plan.some((e) => e.action === "execute_mutation");
      if (attemptedMutation && input.lease && !input.lease.isValid()) {
        console.warn(
          "[whatsapp-agent/orchestrator] lease lost during tool execution, aborting turn without replying",
          {
            job_id: input.jobId,
          },
        );
        return {
          replyText: null,
          handoffRequested,
          bookingId,
          error: "lease_lost",
          leaseLost: true,
        };
      }

      if (consecutiveToolFailures >= MAX_CONSECUTIVE_TOOL_FAILURES) {
        handoffReason =
          handoffReason ||
          "Varios tool calls fallaron seguidos — no se pudo resolver el pedido de forma segura.";
        await requestHumanHandoff(admin, conversation, handoffReason);
        const fallback =
          "Perdón, tuve un problema para procesar tu pedido. Ya avisé a una persona del equipo para que te ayude.";
        await sendFallback(admin, conversation, input.jobId, fallback);
        if (bookingId) await updateConversation(admin, conversation.id, { booking_id: bookingId });
        return {
          replyText: fallback,
          handoffRequested: true,
          bookingId,
          error: null,
          leaseLost: false,
        };
      }

      messages.push({ role: "user", content: toolResults });
      await appendMessage(admin, conversation.id, {
        role: "user",
        raw_content: toolResults,
        job_id: input.jobId,
      });
    }

    // Exceeded MAX_TOOL_ITERATIONS without a final answer — never leave the customer hanging,
    // and never let the model keep guessing past the bound we set for it.
    await requestHumanHandoff(
      admin,
      conversation,
      "El agente no resolvió el pedido dentro del límite de pasos permitido.",
    );
    const fallback = "Dejame confirmarlo con el equipo y te contesto en breve.";
    await sendFallback(admin, conversation, input.jobId, fallback);
    if (bookingId) await updateConversation(admin, conversation.id, { booking_id: bookingId });
    return {
      replyText: fallback,
      handoffRequested: true,
      bookingId,
      error: null,
      leaseLost: false,
    };
  } catch (e) {
    console.error("[whatsapp-agent/orchestrator] turn failed", e);
    const message = String((e as Error)?.message ?? e);
    try {
      await requestHumanHandoff(
        admin,
        conversation,
        `Error técnico del agente: ${message.slice(0, 200)}`,
      );
    } catch (e2) {
      console.error("[whatsapp-agent/orchestrator] handoff-on-error failed", e2);
    }
    const fallback = "Perdón, tuve un problema técnico. Ya te va a contestar alguien del equipo.";
    try {
      await sendFallback(admin, conversation, input.jobId, fallback);
    } catch {
      /* best effort — don't let logging failures mask the original error */
    }
    return {
      replyText: fallback,
      handoffRequested: true,
      bookingId,
      error: message,
      leaseLost: false,
    };
  }
}
