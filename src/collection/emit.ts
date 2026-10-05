import type { Collector } from "@deft/collection-sdk";
import { collector } from "./client.js";
import { hasUsageConsent } from "./consent.js";

/**
 * Fire-and-forget usage metrics. Never throws; never affects host verb exit codes.
 */

export type UsageDimensions = Readonly<Record<string, string | number | boolean>>;

export const USAGE_DIMENSIONS_MAX_JSON_BYTES = 2048;

export interface EmitUsageOptions {
  readonly period?: string;
  readonly dimensions?: UsageDimensions;
  readonly collector?: Collector;
  readonly debug?: boolean;
}

export type EmitUsageOutcome =
  | { readonly emitted: true; readonly id: string }
  | {
      readonly emitted: false;
      readonly reason: "no_consent" | "submit_failed";
      readonly code?: string;
    };

export function dimensionsJsonByteLength(dimensions: UsageDimensions): number {
  return Buffer.byteLength(JSON.stringify(dimensions), "utf8");
}

export async function emitUsage(
  projectRoot: string,
  metric: string,
  value: number,
  opts: EmitUsageOptions = {},
): Promise<EmitUsageOutcome> {
  if (!hasUsageConsent(projectRoot)) {
    return { emitted: false, reason: "no_consent" };
  }

  if (opts.dimensions !== undefined) {
    if (dimensionsJsonByteLength(opts.dimensions) > USAGE_DIMENSIONS_MAX_JSON_BYTES) {
      return { emitted: false, reason: "submit_failed", code: "dimensions_too_large" };
    }
  }

  try {
    const col = opts.collector ?? collector(projectRoot);
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
      if (opts.debug === true || process.env.CANONICAL_COLLECTION_DEBUG === "1") {
        process.stderr.write(
          `canon: collection metric skipped -- ${result.code} (retryable=${result.retryable})\n`,
        );
      }
      return { emitted: false, reason: "submit_failed", code: result.code };
    }
    return { emitted: true, id: result.id };
  } catch (err) {
    if (opts.debug === true || process.env.CANONICAL_COLLECTION_DEBUG === "1") {
      process.stderr.write(
        `canon: collection metric error -- ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
    return { emitted: false, reason: "submit_failed", code: "transport_error" };
  }
}
