import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cleanupTempDirs, git, tempGitRepo } from "../test-support/index.js";
import {
  evaluateForwardCoverage,
  expectedTestBasenames,
  isSourceFile,
  isTestFile,
} from "./index.js";

afterAll(cleanupTempDirs);

function stage(root: string, relPath: string, content: string): void {
  const full = join(root, relPath);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content);
  git(root, "add", relPath);
}

describe("isTestFile / isSourceFile / expectedTestBasenames", () => {
  it("recognizes co-located test conventions", () => {
    expect(isTestFile("src/foo.test.ts")).toBe(true);
    expect(isTestFile("src/foo.spec.ts")).toBe(true);
    expect(isTestFile("cmd/foo_test.go")).toBe(true);
    expect(isTestFile("scripts/test_foo.py")).toBe(true);
    expect(isTestFile("scripts/foo_test.py")).toBe(true);
    expect(isTestFile("src/foo.ts")).toBe(false);
  });

  it("excludes .d.ts and files outside configured roots", () => {
    const roots = ["src/"];
    expect(isSourceFile("src/foo.ts", roots)).toBe(true);
    expect(isSourceFile("src/foo.d.ts", roots)).toBe(false);
    expect(isSourceFile("other/foo.ts", roots)).toBe(false);
    expect(isSourceFile("src/foo.test.ts", roots)).toBe(false);
  });

  it("computes expected test basenames per extension", () => {
    expect(expectedTestBasenames("src/foo.ts")).toEqual(["foo.test.ts", "foo.spec.ts"]);
    expect(expectedTestBasenames("cmd/foo.go")).toEqual(["foo_test.go"]);
    expect(expectedTestBasenames("scripts/foo.py")).toEqual(["test_foo.py", "foo_test.py"]);
  });
});

describe("evaluateForwardCoverage", () => {
  it("exits 0 when a new source file ships with a matching staged test", () => {
    const root = tempGitRepo();
    stage(root, "src/foo.ts", "export const foo = 1;\n");
    stage(root, "src/foo.test.ts", "test('foo', () => {});\n");
    const result = evaluateForwardCoverage(root, { roots: ["src/"] });
    expect(result.code).toBe(0);
    expect(result.missing).toHaveLength(0);
  });

  it("exits 1 when a new source file has no matching staged test", () => {
    const root = tempGitRepo();
    stage(root, "src/foo.ts", "export const foo = 1;\n");
    const result = evaluateForwardCoverage(root, { roots: ["src/"] });
    expect(result.code).toBe(1);
    expect(result.missing).toEqual([expect.objectContaining({ path: "src/foo.ts" })]);
    expect(result.message).toContain("src/foo.ts");
  });

  it("ignores new files outside the configured roots", () => {
    const root = tempGitRepo();
    stage(root, "docs/notes.ts", "export const x = 1;\n");
    const result = evaluateForwardCoverage(root, { roots: ["src/"] });
    expect(result.code).toBe(0);
  });

  it("accepts a modified (not just new) staged test file as coverage", () => {
    const root = tempGitRepo();
    stage(root, "src/bar.test.ts", "test('bar', () => {});\n");
    git(root, "commit", "-q", "-m", "seed test file");
    stage(root, "src/bar.ts", "export const bar = 1;\n");
    writeFileSync(join(root, "src", "bar.test.ts"), "test('bar', () => { /* updated */ });\n");
    git(root, "add", "src/bar.test.ts");
    const result = evaluateForwardCoverage(root, { roots: ["src/"] });
    expect(result.code).toBe(0);
  });

  it("reads quality.forwardCoverageRoots from xbrief/PROJECT.json when roots are not overridden", () => {
    const root = tempGitRepo();
    writeFileSync(
      join(root, "xbrief", "PROJECT.json"),
      JSON.stringify({ quality: { forwardCoverageRoots: ["app/"] } }),
    );
    git(root, "add", "xbrief/PROJECT.json");
    git(root, "commit", "-q", "-m", "configure roots");
    stage(root, "app/widget.ts", "export const widget = 1;\n");
    const result = evaluateForwardCoverage(root);
    expect(result.code).toBe(1);
    expect(result.missing[0]?.path).toBe("app/widget.ts");
  });
});
