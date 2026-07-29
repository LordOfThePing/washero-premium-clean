// Run with: deno test --allow-env supabase/functions/_shared/whatsapp-agent/orchestrator-tool-planning.test.ts
//
// Unit tests for planToolExecution/runToolPlan (production-hardening audit — "safe tool execution
// ordering"). Pure logic, no DB/network — proves WHICH calls run, which are rejected, and in what
// order/grouping, without needing a live Claude response.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { planToolExecution, runToolPlan, type ToolUseBlock } from "./orchestrator.ts";

function block(id: string, name: string, input: Record<string, unknown> = {}): ToolUseBlock {
  return { type: "tool_use", id, name, input };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Records "start:<id>" / "end:<id>" so tests can prove concurrency vs strict sequencing from the
 * log shape alone, without relying on flaky wall-clock timing assertions. */
function makeLoggingExecutor(log: string[], delays: Record<string, number> = {}) {
  return async (b: ToolUseBlock) => {
    log.push(`start:${b.id}`);
    const delay = delays[b.id] ?? 0;
    if (delay > 0) await sleep(delay);
    log.push(`end:${b.id}`);
    return { ok: true, id: b.id };
  };
}

// ---------------------------------------------------------------------------
// 1. Several independent read-only calls
// ---------------------------------------------------------------------------
Deno.test(
  "(1) several independent read-only calls: none rejected, all execute concurrently",
  async () => {
    const blocks = [
      block("r1", "get_services"),
      block("r2", "get_customer_by_phone"),
      block("r3", "list_customer_bookings"),
    ];
    const plan = planToolExecution(blocks, { handoffAlreadyTriggered: false });
    assertEquals(
      plan.every((e) => e.action === "execute_read"),
      true,
    );

    const log: string[] = [];
    // r1 is slow; if r2/r3 start before r1 ends, that proves they ran in parallel, not sequentially.
    const results = await runToolPlan(plan, makeLoggingExecutor(log, { r1: 30 }));
    assertEquals(results.size, 3);
    for (const b of blocks) assertEquals(results.get(b.id)?.ok, true);

    const r1EndIndex = log.indexOf("end:r1");
    const r2StartIndex = log.indexOf("start:r2");
    const r3StartIndex = log.indexOf("start:r3");
    assert(
      r2StartIndex < r1EndIndex,
      "r2 must start before slow r1 ends (proves parallel execution)",
    );
    assert(
      r3StartIndex < r1EndIndex,
      "r3 must start before slow r1 ends (proves parallel execution)",
    );
  },
);

// ---------------------------------------------------------------------------
// 2. Two create_booking calls
// ---------------------------------------------------------------------------
Deno.test(
  "(2) two create_booking calls: only the first executes, the second is rejected",
  async () => {
    const blocks = [block("m1", "create_booking"), block("m2", "create_booking")];
    const plan = planToolExecution(blocks, { handoffAlreadyTriggered: false });

    assertEquals(plan[0].action, "execute_mutation");
    assertEquals(plan[1].action, "reject");
    assertEquals(plan[1].rejectReason, "multiple_mutations_in_one_turn");

    const log: string[] = [];
    const results = await runToolPlan(plan, makeLoggingExecutor(log));
    assertEquals(results.get("m1")?.ok, true);
    assertEquals(results.get("m2")?.ok, false);
    assertEquals(results.get("m2")?.error, "multiple_mutations_in_one_turn");
    assert(!log.includes("start:m2"), "the rejected second mutation must never actually execute");
  },
);

// ---------------------------------------------------------------------------
// 3. create_booking and reschedule_booking (two DIFFERENT mutation tools)
// ---------------------------------------------------------------------------
Deno.test(
  "(3) create_booking + reschedule_booking together: only the first mutation by position executes",
  async () => {
    const blocks = [block("m1", "create_booking"), block("m2", "reschedule_booking")];
    const plan = planToolExecution(blocks, { handoffAlreadyTriggered: false });

    assertEquals(plan[0].action, "execute_mutation");
    assertEquals(plan[1].action, "reject");
    assertEquals(plan[1].rejectReason, "multiple_mutations_in_one_turn");

    const log: string[] = [];
    await runToolPlan(plan, makeLoggingExecutor(log));
    assert(
      !log.includes("start:m2"),
      "a second, different mutation tool must still be rejected, not just duplicates of the same tool",
    );
  },
);

// ---------------------------------------------------------------------------
// 4. request_human_handoff followed by create_booking
// ---------------------------------------------------------------------------
Deno.test(
  "(4) request_human_handoff followed by create_booking: handoff executes, the mutation is rejected",
  async () => {
    const blocks = [block("h1", "request_human_handoff"), block("m1", "create_booking")];
    const plan = planToolExecution(blocks, { handoffAlreadyTriggered: false });

    assertEquals(plan[0].action, "execute_handoff");
    assertEquals(plan[1].action, "reject");
    assertEquals(plan[1].rejectReason, "handoff_triggered_in_same_response");

    const log: string[] = [];
    const results = await runToolPlan(plan, makeLoggingExecutor(log));
    assertEquals(results.get("h1")?.ok, true);
    assertEquals(results.get("m1")?.ok, false);
    assert(
      !log.includes("start:m1"),
      "a mutation in the same response as a handoff call must never execute",
    );
  },
);

Deno.test(
  "(4b) a mutation positioned BEFORE the handoff call in the same response is still rejected",
  async () => {
    // "do not rely on the model behaving correctly" — position must not matter.
    const blocks = [block("m1", "create_booking"), block("h1", "request_human_handoff")];
    const plan = planToolExecution(blocks, { handoffAlreadyTriggered: false });
    assertEquals(plan.find((e) => e.block.id === "m1")?.action, "reject");
    assertEquals(plan.find((e) => e.block.id === "h1")?.action, "execute_handoff");
  },
);

Deno.test(
  "(4c) handoff already triggered in an earlier iteration blocks mutations in this one too",
  () => {
    const blocks = [block("m1", "create_booking")];
    const plan = planToolExecution(blocks, { handoffAlreadyTriggered: true });
    assertEquals(plan[0].action, "reject");
    assertEquals(plan[0].rejectReason, "handoff_already_triggered_this_turn");
  },
);

// ---------------------------------------------------------------------------
// 5. An availability read followed by create_booking
// ---------------------------------------------------------------------------
Deno.test(
  "(5) availability read followed by create_booking: both execute, read strictly before the mutation",
  async () => {
    const blocks = [block("r1", "get_available_slots"), block("m1", "create_booking")];
    const plan = planToolExecution(blocks, { handoffAlreadyTriggered: false });
    assertEquals(plan[0].action, "execute_read");
    assertEquals(plan[1].action, "execute_mutation");

    const log: string[] = [];
    const results = await runToolPlan(plan, makeLoggingExecutor(log, { r1: 20 }));
    assertEquals(results.get("r1")?.ok, true);
    assertEquals(results.get("m1")?.ok, true);

    const r1EndIndex = log.indexOf("end:r1");
    const m1StartIndex = log.indexOf("start:m1");
    assert(
      r1EndIndex < m1StartIndex,
      "the read must fully complete before the mutation starts — no concurrency between them",
    );
  },
);

// ---------------------------------------------------------------------------
// 6. A mutation followed by another read
// ---------------------------------------------------------------------------
Deno.test(
  "(6) mutation followed by another read: both execute, the read strictly after the mutation",
  async () => {
    const blocks = [block("m1", "create_booking"), block("r1", "get_booking")];
    const plan = planToolExecution(blocks, { handoffAlreadyTriggered: false });
    assertEquals(plan[0].action, "execute_mutation");
    assertEquals(plan[1].action, "execute_read");

    const log: string[] = [];
    const results = await runToolPlan(plan, makeLoggingExecutor(log, { m1: 20 }));
    assertEquals(results.get("m1")?.ok, true);
    assertEquals(results.get("r1")?.ok, true);

    const m1EndIndex = log.indexOf("end:m1");
    const r1StartIndex = log.indexOf("start:r1");
    assert(
      m1EndIndex < r1StartIndex,
      "a read positioned after the mutation must wait for it to finish (it likely wants the mutation's effect)",
    );
  },
);

// ---------------------------------------------------------------------------
// 7. Malformed or unknown tool calls mixed with valid calls
// ---------------------------------------------------------------------------
Deno.test(
  "(7) malformed input and unknown tool names are rejected without blocking valid calls",
  async () => {
    const blocks = [
      block("ok1", "get_services"),
      {
        type: "tool_use" as const,
        id: "bad1",
        name: "get_services",
        input: "not-an-object" as unknown as Record<string, unknown>,
      },
      block("bad2", "totally_made_up_tool_name"),
      block("m1", "create_booking"),
    ];
    const plan = planToolExecution(blocks, { handoffAlreadyTriggered: false });

    assertEquals(plan.find((e) => e.block.id === "ok1")?.action, "execute_read");
    assertEquals(plan.find((e) => e.block.id === "bad1")?.action, "reject");
    assertEquals(plan.find((e) => e.block.id === "bad1")?.rejectReason, "malformed_tool_input");
    assertEquals(plan.find((e) => e.block.id === "bad2")?.action, "reject");
    assertEquals(plan.find((e) => e.block.id === "bad2")?.rejectReason, "unknown_tool");
    assertEquals(plan.find((e) => e.block.id === "m1")?.action, "execute_mutation");

    const log: string[] = [];
    const results = await runToolPlan(plan, makeLoggingExecutor(log));
    assertEquals(results.size, 4, "every block must get a result, rejected or not");
    assertEquals(results.get("ok1")?.ok, true);
    assertEquals(results.get("m1")?.ok, true);
    assert(!log.includes("start:bad1"));
    assert(!log.includes("start:bad2"));
  },
);
