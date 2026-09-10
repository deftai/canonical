import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { UsageDimensions } from "../collection/emit.js";

export interface CoverageSummary {
  readonly linesPct?: number;
  readonly branchesPct?: number;
  readonly thresholdPct?: number;
  readonly testCount?: number;
}

const CANDIDATE_PATHS = ["coverage/coverage-summary.json", "coverage/coverage-final.json"] as const;

function roundPct(value: number): number {
  return Math.round(Math.min(Math.max(value, 0), 100));
}

/** Parse Istanbul-style coverage summary JSON (vitest/c8/nyc output). */
function parseIstanbulSummary(data: unknown): CoverageSummary | undefined {
  if (data === null || typeof data !== "object") {
    return undefined;
  }
  const total = (data as Record<string, unknown>).total;
  if (total === null || typeof total !== "object") {
    return undefined;
  }
  const t = total as Record<string, unknown>;
  const lines = t.lines as { pct?: number } | undefined;
  const branches = t.branches as { pct?: number } | undefined;
  const result: CoverageSummary = {};
  if (typeof lines?.pct === "number" && Number.isFinite(lines.pct)) {
    result.linesPct = roundPct(lines.pct);
  }
  if (typeof branches?.pct === "number" && Number.isFinite(branches.pct)) {
    result.branchesPct = roundPct(branches.pct);
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

/** Best-effort read of vitest threshold from config (omit when absent). */
function readVitestLinesThreshold(projectRoot: string): number | undefined {
  const configPath = join(projectRoot, "vitest.config.ts");
  if (!existsSync(configPath)) {
    return undefined;
  }
  try {
    const raw = readFileSync(configPath, "utf8");
    const match = raw.match(/thresholds:\s*\{[^}]*lines:\s*(\d+)/);
    if (match?.[1] !== undefined) {
      const value = Number(match[1]);
      return Number.isFinite(value) ? value : undefined;
    }
  } catch {
    // omit threshold
  }
  return undefined;
}

/** Read coverage summary from disk after a successful test stage; never fabricates. */
export function readCoverageSummary(projectRoot: string): CoverageSummary | undefined {
  for (const rel of CANDIDATE_PATHS) {
    const abs = join(projectRoot, rel);
    if (!existsSync(abs)) {
      continue;
    }
    try {
      const parsed: unknown = JSON.parse(readFileSync(abs, "utf8"));
      const summary = parseIstanbulSummary(parsed);
      if (summary !== undefined) {
        const threshold = readVitestLinesThreshold(projectRoot);
        return threshold !== undefined ? { ...summary, thresholdPct: threshold } : summary;
      }
    } catch {
      // try next candidate
    }
  }
  return undefined;
}

/** Usage dimensions for check_pass/check_fail when coverage tooling produced output. */
export function coverageCheckDimensions(projectRoot: string): UsageDimensions | undefined {
  const summary = readCoverageSummary(projectRoot);
  if (summary === undefined) {
    return undefined;
  }
  const dims: Record<string, string | number | boolean> = {};
  if (summary.linesPct !== undefined) {
    dims.coverage_lines_pct = summary.linesPct;
  }
  if (summary.branchesPct !== undefined) {
    dims.coverage_branches_pct = summary.branchesPct;
  }
  if (summary.thresholdPct !== undefined) {
    dims.coverage_threshold_pct = summary.thresholdPct;
  }
  if (summary.testCount !== undefined) {
    dims.test_count = summary.testCount;
  }
  return Object.keys(dims).length > 0 ? dims : undefined;
}
