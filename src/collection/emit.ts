import type { Collector } from "@deft/collection-sdk";
import { type CreateCanonicalCollectorOptions, createCanonicalCollector } from "./client.js";
import { hasUsageConsent, readCollectionFile } from "./storage.js";

/**
 * Fire-and-forget usage metrics. Never throws; never affects host verb exit codes.
 */

/** Optional structured dimensions on usage events (SUB-5a / Canonical #9). */
export type UsageDimensions = Readonly<Record<string, string | number | boolean>>;

/** Soft client-side cap so we fail closed before the wire (issue #9: ≤2 KiB). */
export const USAGE_DIMENSIONS_MAX_JSON_BYTES = 2048;

export interface EmitUsageOptions extends CreateCanonicalCollectorOptions {
  readonly period?: string;
  readonly dimensions?: UsageDimensions;
  /** Injected collector (tests). */
  readonly collector?: Collector;
  /** When true, write soft-failure detail to stderr. */
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
  const file = readCollectionFile(projectRoot);
  if (!hasUsageConsent(file)) {
    return { emitted: false, reason: "no_consent" };
  }

  if (opts.dimensions !== undefined) {
    if (dimensionsJsonByteLength(opts.dimensions) > USAGE_DIMENSIONS_MAX_JSON_BYTES) {
      return { emitted: false, reason: "submit_failed", code: "dimensions_too_large" };
    }
  }

  try {
    const collector =
      opts.collector ??
      createCanonicalCollector(projectRoot, {
        configDir: opts.configDir,
        baseUrl: opts.baseUrl,
        environment: opts.environment,
        version: opts.version,
        fetch: opts.fetch,
      });
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
    const result = await collector.submit("usage", payload);
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
