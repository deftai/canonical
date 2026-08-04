import { existsSync } from "node:fs";
import { join } from "node:path";
import { cleanupTempDirs, tempDir, tempGitRepo } from "@canonpack/core/test-support";
import { afterAll, describe, expect, it, vi } from "vitest";
import { run } from "./setup.js";

afterAll(cleanupTempDirs);

function captureStd(): { out: string[]; err: string[]; restore: () => void } {
  const out: string[] = [];
  const err: string[] = [];
  const outSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    out.push(String(chunk));
    return true;
  });
  const errSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    err.push(String(chunk));
    return true;
  });
  return {
    out,
    err,
    restore: () => {
      outSpy.mockRestore();
      errSpy.mockRestore();
    },
  };
}

describe("setup handler", () => {
  it("deposits hooks and exits 0", () => {
    const root = tempGitRepo();
    const cap = captureStd();
    const code = run(["--project-root", root]);
    cap.restore();
    expect(code).toBe(0);
    expect(existsSync(join(root, ".githooks", "pre-commit"))).toBe(true);
    expect(existsSync(join(root, ".githooks", "pre-push"))).toBe(true);
    expect(cap.out.join("")).toContain("core.hooksPath");
  });

  it("returns 2 on a malformed flag", () => {
    const cap = captureStd();
    const code = run(["--nope"]);
    cap.restore();
    expect(code).toBe(2);
  });

  it("--json emits sorted-key JSON", () => {
    const root = tempGitRepo();
    const cap = captureStd();
    const code = run(["--project-root", root, "--json"]);
    cap.restore();
    expect(code).toBe(0);
    const parsed = JSON.parse(cap.out.join(""));
    expect(Object.keys(parsed)).toEqual([...Object.keys(parsed)].sort());
    expect(parsed.exit_code).toBe(0);
  });

  it("returns 2 when hooks cannot be written (not a git repository)", () => {
    const notGit = tempDir("canon-not-a-repo-");
    const cap = captureStd();
    const code = run(["--project-root", notGit]);
    cap.restore();
    expect(code).toBe(2);
    expect(cap.err.join("")).toContain("core.hooksPath");
  });
});
