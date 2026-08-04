import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupTempDirs, tempGitRepo } from "../test-support/index.js";
import { run } from "./init.js";

afterAll(() => {
  cleanupTempDirs();
});

let out = "";
let err = "";
let outSpy: ReturnType<typeof vi.spyOn>;
let errSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  out = "";
  err = "";
  outSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    out += String(chunk);
    return true;
  });
  errSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    err += String(chunk);
    return true;
  });
});

afterEach(() => {
  outSpy.mockRestore();
  errSpy.mockRestore();
});

describe("canon init", () => {
  it("deposits into --project-root and exits 0", () => {
    const root = tempGitRepo({ withBriefs: false });
    const code = run(["--project-root", root]);
    expect(code).toBe(0);
    expect(existsSync(join(root, ".canonical", "core", "canonical.md"))).toBe(true);
    expect(out).toContain("written:");
  });

  it("--json prints a single-line JSON summary", () => {
    const root = tempGitRepo({ withBriefs: false });
    const code = run(["--project-root", root, "--json"]);
    expect(code).toBe(0);
    const parsed = JSON.parse(out.trim());
    expect(parsed).toHaveProperty("written");
    expect(parsed).toHaveProperty("skipped");
    expect(parsed).toHaveProperty("warnings");
  });

  it("exits 2 for an invalid project root", () => {
    const code = run(["--project-root", "/definitely/not/real/xyz"]);
    expect(code).toBe(2);
    expect(err).toContain("canon:");
  });

  it("exits 2 on a malformed flag", () => {
    const code = run(["--project-root"]);
    expect(code).toBe(2);
  });
});
