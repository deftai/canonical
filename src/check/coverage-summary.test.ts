import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cleanupTempDirs, tempDir } from "../test-support/index.js";
import { coverageCheckDimensions, readCoverageSummary } from "./coverage-summary.js";

afterAll(() => cleanupTempDirs());

describe("coverage-summary (#9)", () => {
  it("parses istanbul coverage-summary.json when present", () => {
    const root = tempDir("canon-cov-");
    mkdirSync(join(root, "coverage"), { recursive: true });
    writeFileSync(
      join(root, "coverage", "coverage-summary.json"),
      `${JSON.stringify({
        total: {
          lines: { pct: 91.2 },
          branches: { pct: 84.6 },
        },
      })}\n`,
    );
    expect(readCoverageSummary(root)).toEqual({
      linesPct: 91,
      branchesPct: 85,
    });
    expect(coverageCheckDimensions(root)).toEqual({
      coverage_lines_pct: 91,
      coverage_branches_pct: 85,
    });
  });

  it("returns undefined when no coverage artifacts exist", () => {
    const root = tempDir("canon-cov-missing-");
    expect(readCoverageSummary(root)).toBeUndefined();
    expect(coverageCheckDimensions(root)).toBeUndefined();
  });
});
