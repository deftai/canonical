import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cleanupTempDirs, tempDir, tempGitRepo } from "./temp.js";

afterAll(() => cleanupTempDirs());

describe("temp helpers", () => {
  it("tempDir creates a real directory that cleanupTempDirs removes", () => {
    const dir = tempDir("canon-temp-unit-");
    expect(existsSync(dir)).toBe(true);
    const marker = join(dir, "marker.txt");
    writeFileSync(marker, "ok\n");
    expect(existsSync(marker)).toBe(true);
    cleanupTempDirs();
    expect(existsSync(dir)).toBe(false);
  });

  it("tempGitRepo initializes a git repo with xbrief scaffold by default", () => {
    const root = tempGitRepo();
    expect(existsSync(join(root, ".git"))).toBe(true);
    expect(existsSync(join(root, "xbrief", "PROJECT.xbrief.json"))).toBe(true);
    expect(existsSync(join(root, "xbrief", "proposed"))).toBe(true);
  });
});
