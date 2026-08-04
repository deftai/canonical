import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupTempDirs, tempGitRepo, writeScopeFixture } from "../test-support/index.js";
import { run } from "./state-validate.js";

afterAll(() => {
  cleanupTempDirs();
});

let out: string[];
let err: string[];

beforeEach(() => {
  out = [];
  err = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    out.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    err.push(String(chunk));
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("state-validate handler", () => {
  it("exits 2 on an unknown flag", () => {
    const code = run(["--nope"]);
    expect(code).toBe(2);
    expect(err.join("")).toContain("unknown flag");
  });

  it("exits 2 when --project-root does not exist", () => {
    const code = run(["--project-root", "/no/such/directory/at/all"]);
    expect(code).toBe(2);
    expect(err.join("")).toContain("project root not found");
  });

  it("exits 0 with no findings on a clean tree", () => {
    const root = tempGitRepo();
    writeScopeFixture(root, "proposed", "2026-01-01-happy.json");
    const code = run(["--project-root", root]);
    expect(code).toBe(0);
    expect(out.join("")).toContain("state ok");
    expect(err.join("")).toBe("");
  });

  it("exits 1 and prints per-file findings to stderr on violations", () => {
    const root = tempGitRepo();
    writeScopeFixture(root, "active", "2026-01-01-mismatch.json"); // proposed status filed under active/
    const code = run(["--project-root", root]);
    expect(code).toBe(1);
    expect(out.join("")).toBe("");
    expect(err.join("")).toContain("briefs/active/2026-01-01-mismatch.json");
    expect(err.join("")).toContain("folder-status-mismatch");
  });

  it("--json reports ok on stdout with the same exit code", () => {
    const root = tempGitRepo();
    writeScopeFixture(root, "proposed", "2026-01-01-happy.json");
    const code = run(["--project-root", root, "--json"]);
    expect(code).toBe(0);
    const payload = JSON.parse(out.join(""));
    expect(payload).toEqual({ findings: [], ok: true, scanned: 1 });
  });

  it("--json reports violations on stdout with exit 1", () => {
    const root = tempGitRepo();
    writeScopeFixture(root, "active", "2026-01-01-mismatch.json");
    const code = run(["--project-root", root, "--json"]);
    expect(code).toBe(1);
    expect(err.join("")).toBe("");
    const payload = JSON.parse(out.join(""));
    expect(payload.ok).toBe(false);
    expect(payload.findings).toHaveLength(1);
    expect(payload.findings[0].code).toBe("folder-status-mismatch");
  });
});
