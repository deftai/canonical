import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupTempDirs, git, tempGitRepo } from "@canonpack/core/test-support";
import { afterAll, describe, expect, it, vi } from "vitest";
import { run } from "./verify-encoding.js";

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

describe("verify-encoding handler", () => {
  it("exits 0 on a clean repo", () => {
    const root = tempGitRepo();
    const cap = captureStd();
    const code = run(["--project-root", root]);
    cap.restore();
    expect(code).toBe(0);
  });

  it("exits 1 with a file:line list when corruption is tracked", () => {
    const root = tempGitRepo();
    writeFileSync(join(root, "broken.txt"), "bad � char\n");
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "add broken");
    const cap = captureStd();
    const code = run(["--project-root", root]);
    cap.restore();
    expect(code).toBe(1);
    expect(cap.err.join("")).toContain("broken.txt:1");
  });

  it("--staged only scans the index", () => {
    const root = tempGitRepo();
    writeFileSync(join(root, "clean.txt"), "fine\n");
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "clean");
    writeFileSync(join(root, "clean.txt"), "bad � char\n");
    const cap = captureStd();
    const code = run(["--project-root", root, "--staged"]);
    cap.restore();
    expect(code).toBe(0);
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
});
