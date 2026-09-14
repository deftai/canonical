import { type EmitUsageOutcome, emitUsage, type UsageDimensions } from "./emit.js";

/** Soft-emit budget so a hung collector cannot stall host verbs. */
export const SOFT_EMIT_TIMEOUT_MS = 2_500;

/** Max wait for in-flight late emits before CLI exit. */
export const LATE_EMIT_DRAIN_MS = SOFT_EMIT_TIMEOUT_MS;

const pendingLateEmits = new Set<Promise<void>>();

export interface SoftEmitUsageOptions {
  /** Invoked when emit succeeds after the soft timeout (e.g. inventory throttle). */
  readonly onLateEmit?: () => void;
}

/** Await detached late emits (bounded) so CLI exit does not drop throttle hooks. */
export async function drainSoftEmits(maxWaitMs: number = LATE_EMIT_DRAIN_MS): Promise<void> {
  if (pendingLateEmits.size === 0) {
    return;
  }
  await Promise.race([
    Promise.allSettled([...pendingLateEmits]),
    new Promise<void>((resolve) => {
      setTimeout(resolve, maxWaitMs);
    }),
  ]);
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
    let settled = false;
    const emitTask = emitUsage(projectRoot, metric, value, {
      ...(dimensions !== undefined ? { dimensions } : {}),
    });

    const outcome = await Promise.race([
      emitTask,
      new Promise<{ emitted: false; reason: "submit_failed" }>((resolve) => {
        setTimeout(() => {
          if (!settled) {
            settled = true;
            resolve({ emitted: false, reason: "submit_failed" });
          }
        }, SOFT_EMIT_TIMEOUT_MS);
      }),
    ]);

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
    pendingLateEmits.add(lateWork);
    void lateWork.finally(() => {
      pendingLateEmits.delete(lateWork);
    });
    return false;
  } catch {
    // telemetry must never break the host verb
    return false;
  }
}
