// @ts-nocheck -- ported verbatim from supabase/functions; not our source of truth for types
// Renewable lease / heartbeat for a claimed whatsapp_agent_job (second-pass correctness fix,
// replacing a fixed "reclaim after N seconds since claim" threshold — see job-queue.ts and the
// migration 20260722100400 comments for why that was wrong).
//
// LEASE_RENEWAL_INTERVAL_MS is a THIRD of LEASE_SECONDS (job-queue.ts): a single missed/delayed
// renewal (GC pause, brief network hiccup) still leaves ~30s of buffer before the lease actually
// expires, while a worker that genuinely stops running (crash, instance recycle) is detected and
// reclaimed within one lease window (45s) of going silent — independent of how long the overall
// job legitimately runs (see orchestrator.ts's MAX_TURN_DURATION_ESTIMATE_MS for that separate
// number). Renewal itself is timeout-bounded and fails closed: any error or timeout marks the
// lease invalid rather than assuming it's still held.
import type { SupabaseClient } from "@supabase/supabase-js";
import { LEASE_SECONDS, renewLease } from "./job-queue.ts";

const LEASE_RENEWAL_INTERVAL_MS = Math.floor((LEASE_SECONDS * 1000) / 3);
const RENEWAL_CALL_TIMEOUT_MS = 10_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error("lease_renew_timeout")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId)) as Promise<T>;
}

/** Read-only view handed to the orchestrator — it can check validity but never renew/stop the lease itself. */
export type LeaseView = { isValid(): boolean };

export class JobLeaseHeartbeat implements LeaseView {
  private valid = true;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly admin: SupabaseClient,
    private readonly jobId: string,
    public readonly token: string,
  ) {}

  start(): void {
    this.timer = setInterval(() => {
      this.renewOnce().catch((e) => {
        console.error("[whatsapp-agent/job-lease] unexpected renewal error, marking lease lost", e);
        this.valid = false;
        this.stop();
      });
    }, LEASE_RENEWAL_INTERVAL_MS);
  }

  private async renewOnce(): Promise<void> {
    if (!this.valid) return;
    try {
      const ok = await withTimeout(
        renewLease(this.admin, this.jobId, this.token),
        RENEWAL_CALL_TIMEOUT_MS,
      );
      if (!ok) {
        console.warn(
          "[whatsapp-agent/job-lease] lease renewal denied — another worker likely reclaimed this job",
          {
            job_id: this.jobId,
          },
        );
        this.valid = false;
        this.stop();
      }
    } catch (e) {
      console.error(
        "[whatsapp-agent/job-lease] lease renewal failed/timed out, treating lease as lost",
        e,
      );
      this.valid = false;
      this.stop();
    }
  }

  stop(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  isValid(): boolean {
    return this.valid;
  }
}
