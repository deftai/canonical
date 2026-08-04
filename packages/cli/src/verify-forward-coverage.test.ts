import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupTempDirs, git, tempGitRepo } from "@canonpack/core/test-support";
import { afterAll, describe, expect, it, vi } from "vitest";
import { run } from "./verify-forward-coverage.js";

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

function stage(root: string, relPath: string, content: string): void {
  const full = join(root, relPath);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content);
  git(root, "add", relPath);
}

describe("verify-forward-coverage handler", () => {
  it("exits 0 when nothing new is staged", () => {
    const root = tempGitRepo();
    const cap = captureStd();
    const code = run(["--project-root", root]);
    cap.restore();
    expect(code).toBe(0);
  });

  it("exits 1 listing an uncovered new source file", () => {
    const root = tempGitRepo();
    stage(root, "src/foo.ts", "export const foo = 1;\n");
    const cap = captureStd();
    const code = run(["--project-root", root]);
    cap.restore();
    expect(code).toBe(1);
    expect(cap.err.join("")).toContain("src/foo.ts");
  });

  it("exits 0 when the new source file has a staged matching test", () => {
    const root = tempGitRepo();
    stage(root, "src/foo.ts", "export const foo = 1;\n");
    stage(root, "src/foo.test.ts", "test('foo', () => {});\n");
    const cap = captureStd();
    const code = run(["--project-root", root]);
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
