import { type EmitUsageOutcome, emitUsage, type UsageDimensions } from "./emit.js";

/** Soft-emit budget so a hung collector cannot stall host verbs. */
export const SOFT_EMIT_TIMEOUT_MS = 2_500;

/** Extra budget after soft timeout for late success before CLI exit. */
export const LATE_EMIT_GRACE_MS = 500;

interface PendingLateEmit {
  readonly promise: Promise<void>;
  /** Absolute deadline (ms) — startedAt + SOFT_EMIT_TIMEOUT_MS + LATE_EMIT_GRACE_MS. */
  readonly drainUntil: number;
}

const pendingLateEmits = new Set<PendingLateEmit>();

export interface SoftEmitUsageOptions {
  /** Invoked when emit succeeds after the soft timeout (e.g. inventory throttle). */
  readonly onLateEmit?: () => void;
}

/** Await detached late emits (bounded) so CLI exit does not drop throttle hooks. */
export async function drainSoftEmits(): Promise<void> {
  if (pendingLateEmits.size === 0) {
    return;
  }
  const now = Date.now();
  const maxWaitMs = Math.max(0, ...[...pendingLateEmits].map((entry) => entry.drainUntil - now));
  if (maxWaitMs === 0) {
    return;
  }
  await new Promise<void>((resolve) => {
    let fallbackTimer: ReturnType<typeof setTimeout> | undefined;
    void Promise.allSettled([...pendingLateEmits].map((entry) => entry.promise)).then(() => {
      if (fallbackTimer !== undefined) {
        clearTimeout(fallbackTimer);
      }
      resolve();
    });
    fallbackTimer = setTimeout(resolve, maxWaitMs);
  });
}

/** Test-only reset of in-flight late emit tracking. */
export function resetPendingSoftEmitsForTests(): void {
  pendingLateEmits.clear();
}

/** Awaited soft emit for CLI verbs — swallows all errors, never throws. */
export async function softEmitUsage(
  projectRoot: string,
  metric: string,
  value: number = 1,
  dimensions?: UsageDimensions,
  options: SoftEmitUsageOptions = {},
): Promise<boolean> {
  try {
    const startedAt = Date.now();
    let settled = false;
    const emitTask = emitUsage(projectRoot, metric, value, {
      ...(dimensions !== undefined ? { dimensions } : {}),
    });

    let softTimeoutId: ReturnType<typeof setTimeout> | undefined;
    let outcome: Awaited<typeof emitTask> | { emitted: false; reason: "submit_failed" };
    try {
      outcome = await Promise.race([
        emitTask,
        new Promise<{ emitted: false; reason: "submit_failed" }>((resolve) => {
          softTimeoutId = setTimeout(() => {
            if (!settled) {
              settled = true;
              resolve({ emitted: false, reason: "submit_failed" });
            }
          }, SOFT_EMIT_TIMEOUT_MS);
        }),
      ]);
    } finally {
      if (softTimeoutId !== undefined) {
        clearTimeout(softTimeoutId);
      }
    }

    if (outcome.emitted === true) {
      settled = true;
      return true;
    }

    // Timed out — track in-flight emit so late success still honors throttle hooks.
    const lateWork = emitTask
      .then((late: EmitUsageOutcome) => {
        if (late.emitted === true) {
          try {
            options.onLateEmit?.();
          } catch {
            // telemetry must never break the host verb
          }
        }
      })
      .catch(() => {
        // telemetry must never break the host verb
      });
    const pending: PendingLateEmit = {
      promise: lateWork,
      drainUntil: startedAt + SOFT_EMIT_TIMEOUT_MS + LATE_EMIT_GRACE_MS,
    };
    pendingLateEmits.add(pending);
    void lateWork.finally(() => {
      pendingLateEmits.delete(pending);
    });
    return false;
  } catch {
    // telemetry must never break the host verb
    return false;
  }
}
