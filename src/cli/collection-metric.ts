/** `canon collection:metric` -- fire-and-forget usage metric (soft-fail). */
import { parseArgs, renderJson } from "../args/index.js";
import {
  type UsageDimensions,
  USAGE_DIMENSIONS_MAX_JSON_BYTES,
  dimensionsJsonByteLength,
  emitUsage,
} from "../collection/index.js";

function parseDimensionsFlag(
  raw: string | undefined,
): { ok: true; dimensions?: UsageDimensions } | { ok: false; message: string } {
  if (raw === undefined) {
    return { ok: true };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, message: "--dimensions must be valid JSON" };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, message: "--dimensions must be a JSON object" };
  }
  const dimensions: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
      return {
        ok: false,
        message: `--dimensions values must be string|number|boolean (bad key '${key}')`,
      };
    }
    dimensions[key] = value;
  }
  if (dimensionsJsonByteLength(dimensions) > USAGE_DIMENSIONS_MAX_JSON_BYTES) {
    return { ok: false, message: "--dimensions payload exceeds 2KiB" };
  }
  return { ok: true, dimensions };
}

export async function run(argv: string[]): Promise<number> {
  const parsed = parseArgs(argv, {
    valueFlags: ["project-root", "metric", "value", "period", "dimensions"],
    boolFlags: ["json", "debug"],
    maxPositional: 0,
  });
  if (parsed.error !== undefined) {
    process.stderr.write(`canon: collection-metric: ${parsed.error}\n`);
    return 2;
  }

  const metric = parsed.values.metric;
  const valueRaw = parsed.values.value;
  if (metric === undefined || metric.trim().length === 0) {
    process.stderr.write("canon: collection-metric: --metric is required\n");
    return 2;
  }
  if (valueRaw === undefined) {
    process.stderr.write("canon: collection-metric: --value is required\n");
    return 2;
  }
  const value = Number(valueRaw);
  if (!Number.isFinite(value)) {
    process.stderr.write("canon: collection-metric: --value must be a number\n");
    return 2;
  }

  const dims = parseDimensionsFlag(parsed.values.dimensions);
  if (!dims.ok) {
    process.stderr.write(`canon: collection-metric: ${dims.message}\n`);
    return 2;
  }

  const projectRoot = parsed.values["project-root"] ?? ".";
  const outcome = await emitUsage(projectRoot, metric.trim(), value, {
    period: parsed.values.period,
    debug: parsed.flags.debug === true,
    ...(dims.dimensions !== undefined ? { dimensions: dims.dimensions } : {}),
  });

  if (parsed.flags.json === true) {
    process.stdout.write(`${renderJson({ code: 0, ...outcome })}\n`);
  } else if (outcome.emitted) {
    process.stdout.write(`collection:metric emitted id=${outcome.id}\n`);
  } else {
    process.stdout.write(`collection:metric skipped (${outcome.reason})\n`);
  }
  // Soft-fail: always 0 for runtime/consent misses; only bad args return 2 above.
  return 0;
}
