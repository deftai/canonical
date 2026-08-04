import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupTempDirs, tempDir, writeScopeFixture } from "@canonpack/core/test-support";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { run } from "./render.js";

afterAll(() => {
  cleanupTempDirs();
});

function emptyProject(): string {
  const root = tempDir("cli-render-test-");
  for (const folder of ["proposed", "pending", "active", "completed", "cancelled"]) {
    mkdirSync(join(root, "briefs", folder), { recursive: true });
  }
  return root;
}

let outBuf: string[];
let errBuf: string[];
let outSpy: ReturnType<typeof vi.spyOn>;
let errSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  outBuf = [];
  errBuf = [];
  outSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    outBuf.push(String(chunk));
    return true;
  });
  errSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    errBuf.push(String(chunk));
    return true;
  });
});

afterEach(() => {
  outSpy.mockRestore();
  errSpy.mockRestore();
});

describe("canon render", () => {
  it("exits 2 when the positional target is missing", () => {
    const root = emptyProject();
    const code = run(["--project-root", root]);
    expect(code).toBe(2);
    expect(errBuf.join("")).toContain("expected 'roadmap' or 'spec'");
  });

  it("exits 2 when the positional target is not roadmap|spec", () => {
    const root = emptyProject();
    const code = run(["bogus", "--project-root", root]);
    expect(code).toBe(2);
  });

  it("writes ROADMAP.md and exits 0", () => {
    const root = emptyProject();
    writeScopeFixture(root, "proposed", "2026-01-01-a.json", { title: "A" });
    const code = run(["roadmap", "--project-root", root]);
    expect(code).toBe(0);
    expect(readFileSync(join(root, "ROADMAP.md"), "utf8")).toContain("| A | proposed | - | - |");
  });

  it("--check exits 1 when ROADMAP.md is missing", () => {
    const root = emptyProject();
    const code = run(["roadmap", "--check", "--project-root", root]);
    expect(code).toBe(1);
    expect(errBuf.join("")).toContain("ROADMAP.md missing");
  });

  it("--check exits 0 when ROADMAP.md matches the regenerated output", () => {
    const root = emptyProject();
    run(["roadmap", "--project-root", root]);
    const code = run(["roadmap", "--check", "--project-root", root]);
    expect(code).toBe(0);
  });

  it("spec exits 1 (violation) when briefs/spec.json is absent", () => {
    const root = emptyProject();
    const code = run(["spec", "--project-root", root]);
    expect(code).toBe(1);
    expect(errBuf.join("")).toContain("briefs/spec.json missing");
  });

  it("--json prints a one-line key-sorted payload to stdout", () => {
    const root = emptyProject();
    const code = run(["spec", "--project-root", root, "--json"]);
    expect(code).toBe(1);
    expect(errBuf.join("")).toBe("");
    const line = outBuf.join("").trim();
    expect(line.split("\n")).toHaveLength(1);
    expect(JSON.parse(line)).toEqual({
      code: 1,
      message: "briefs/spec.json missing",
      ok: false,
      path: null,
    });
  });
});
