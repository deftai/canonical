import { afterAll, describe, expect, it, vi } from "vitest";
import { cleanupTempDirs, git, tempGitRepo } from "../test-support/index.js";
import { run } from "./verify-branch.js";

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

describe("verify-branch handler", () => {
  it("exits 0 and writes to stdout on a feature branch", () => {
    const root = tempGitRepo({ branch: "main" });
    git(root, "switch", "-c", "feat/y");
    const cap = captureStd();
    const code = run(["--project-root", root]);
    cap.restore();
    expect(code).toBe(0);
    expect(cap.out.join("")).toContain("feat/y");
    expect(cap.err.join("")).toBe("");
  });

  it("exits 1 and writes to stderr on the default branch", () => {
    const root = tempGitRepo({ branch: "main" });
    const cap = captureStd();
    const code = run(["--project-root", root]);
    cap.restore();
    expect(code).toBe(1);
    expect(cap.err.join("")).toContain("default branch");
  });

  it("returns 2 on a malformed flag", () => {
    const cap = captureStd();
    const code = run(["--nope"]);
    cap.restore();
    expect(code).toBe(2);
  });

  it("--json emits a single sorted-key JSON line", () => {
    const root = tempGitRepo({ branch: "main" });
    git(root, "switch", "-c", "feat/z");
    const cap = captureStd();
    const code = run(["--project-root", root, "--json"]);
    cap.restore();
    expect(code).toBe(0);
    const parsed = JSON.parse(cap.out.join(""));
    expect(Object.keys(parsed)).toEqual([...Object.keys(parsed)].sort());
    expect(parsed.exit_code).toBe(0);
  });
});
