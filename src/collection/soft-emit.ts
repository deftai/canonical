import { emitUsage, type UsageDimensions } from "./emit.js";

/** Awaited soft emit for CLI verbs — swallows all errors, never throws. */
export async function softEmitUsage(
  projectRoot: string,
  metric: string,
  value: number = 1,
  dimensions?: UsageDimensions,
): Promise<void> {
  try {
    await emitUsage(projectRoot, metric, value, {
      ...(dimensions !== undefined ? { dimensions } : {}),
    });
  } catch {
    // telemetry must never break the host verb
  }
}
