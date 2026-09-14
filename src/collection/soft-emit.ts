import { type EmitUsageOutcome, emitUsage, type UsageDimensions } from "./emit.js";

/** Soft-emit budget so a hung collector cannot stall host verbs. */
export const SOFT_EMIT_TIMEOUT_MS = 2_500;

export interface SoftEmitUsageOptions {
  /** Invoked when emit succeeds after the soft timeout (e.g. inventory throttle). */
  readonly onLateEmit?: () => void;
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
    void emitTask.then((late: EmitUsageOutcome) => {
      if (late.emitted === true) {
        options.onLateEmit?.();
      }
    });
    return false;
  } catch {
    // telemetry must never break the host verb
    return false;
  }
}
