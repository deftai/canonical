import { usageCollector } from "./consent.js";
export type UsageDimensions = Readonly<Record<string, string | number | boolean>>;
const USAGE_DIMENSIONS_MAX_JSON_BYTES = 2048;
const SOFT_EMIT_TIMEOUT_MS = 2_500;
const LATE_EMIT_GRACE_MS = 500; // soft + grace budgets (MET-10)
interface EmitUsageOptions {
  readonly period?: string;
  readonly dimensions?: UsageDimensions;
  readonly debug?: boolean;
}
type EmitUsageOutcome =
  | { readonly emitted: true; readonly id: string }
  | {
      readonly emitted: false;
      readonly reason: "no_consent" | "submit_failed";
      readonly code?: string;
    };
interface SoftEmitUsageOptions {
  readonly onLateEmit?: () => void;
}
interface PendingLateEmit {
  readonly promise: Promise<void>;
  readonly drainUntil: number;
}
const pendingLateEmits = new Set<PendingLateEmit>();
function dimensionsJsonByteLength(dimensions: UsageDimensions): number {
  return Buffer.byteLength(JSON.stringify(dimensions), "utf8");
}
function debugLine(detail: string, debug?: boolean): void {
  if (debug === true || process.env.CANONICAL_COLLECTION_DEBUG === "1") {
    process.stderr.write(`canon: collection metric ${detail}\n`);
  }
}
export async function emitUsage(
  projectRoot: string,
  metric: string,
  value: number,
  opts: EmitUsageOptions = {},
): Promise<EmitUsageOutcome> {
  const col = usageCollector(projectRoot);
  if (col === undefined) {
    return { emitted: false, reason: "no_consent" };
  }
  if (
    opts.dimensions !== undefined &&
    dimensionsJsonByteLength(opts.dimensions) > USAGE_DIMENSIONS_MAX_JSON_BYTES
  ) {
    return { emitted: false, reason: "submit_failed", code: "dimensions_too_large" };
  }
  try {
    const payload: {
      metric: string;
      value: number;
      period?: string;
      dimensions?: UsageDimensions;
    } = { metric, value };
    if (opts.period !== undefined) {
      payload.period = opts.period;
    }
    if (opts.dimensions !== undefined) {
      payload.dimensions = opts.dimensions;
    }
    const result = await col.submit("usage", payload);
    if (!result.ok) {
      debugLine(`skipped -- ${result.code} (retryable=${result.retryable})`, opts.debug);
      return { emitted: false, reason: "submit_failed", code: result.code };
    }
    return { emitted: true, id: result.id };
  } catch (err) {
    debugLine(`error -- ${err instanceof Error ? err.message : String(err)}`, opts.debug);
    return { emitted: false, reason: "submit_failed", code: "transport_error" };
  }
}
export async function drainSoftEmits(): Promise<void> {
  if (pendingLateEmits.size === 0) {
    return;
  }
  const now = Date.now();
  const maxWaitMs = Math.max(0, ...[...pendingLateEmits].map((e) => e.drainUntil - now));
  if (maxWaitMs === 0) {
    return;
  }
  await new Promise<void>((resolve) => {
    let fallbackTimer: ReturnType<typeof setTimeout> | undefined;
    void Promise.allSettled([...pendingLateEmits].map((e) => e.promise)).then(() => {
      if (fallbackTimer !== undefined) {
        clearTimeout(fallbackTimer);
      }
      resolve();
    });
    fallbackTimer = setTimeout(resolve, maxWaitMs);
  });
}
export function resetPendingSoftEmitsForTests(): void {
  pendingLateEmits.clear();
}
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
    const lateWork = emitTask
      .then((late: EmitUsageOutcome) => {
        if (late.emitted === true) {
          try {
            options.onLateEmit?.();
          } catch {}
        }
      })
      .catch(() => undefined);
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
    return false;
  }
}
