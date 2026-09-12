import { emitUsage, type UsageDimensions } from "./emit.js";

/** Soft-emit budget so a hung collector cannot stall host verbs. */
export const SOFT_EMIT_TIMEOUT_MS = 2_500;

/** Awaited soft emit for CLI verbs — swallows all errors, never throws. */
export async function softEmitUsage(
  projectRoot: string,
  metric: string,
  value: number = 1,
  dimensions?: UsageDimensions,
): Promise<boolean> {
  try {
    const outcome = await Promise.race([
      emitUsage(projectRoot, metric, value, {
        ...(dimensions !== undefined ? { dimensions } : {}),
      }),
      new Promise<{ emitted: false; reason: "submit_failed" }>((resolve) => {
        setTimeout(
          () => resolve({ emitted: false, reason: "submit_failed" }),
          SOFT_EMIT_TIMEOUT_MS,
        );
      }),
    ]);
    return outcome.emitted === true;
  } catch {
    // telemetry must never break the host verb
    return false;
  }
}
