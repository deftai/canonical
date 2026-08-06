import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupTempDirs, tempGitRepo, writeScopeFixture } from "../test-support/index.js";
import { run } from "./work-next.js";

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

describe("work-next handler", () => {
  it("exits 2 on an unknown flag", () => {
    const code = run(["--nope"]);
    expect(code).toBe(2);
  });

  it("exits 2 when --project-root does not exist", () => {
    const code = run(["--project-root", "/no/such/directory/at/all"]);
    expect(code).toBe(2);
    expect(err.join("")).toContain("project root not found");
  });

  it("exits 1 with a message on an empty queue", () => {
    const root = tempGitRepo();
    const code = run(["--project-root", root]);
    expect(code).toBe(1);
    expect(out.join("")).toBe("");
    expect(err.join("")).toContain("no work item available");
  });

  it("exits 0 and prints the next pending scope's path", () => {
    const root = tempGitRepo();
    const rel = writeScopeFixture(root, "pending", "2026-01-01-do-me.xbrief.json", {
      title: "Do me",
      status: "pending",
    });
    const code = run(["--project-root", root]);
    expect(code).toBe(0);
    expect(out.join("")).toContain(rel);
    expect(out.join("")).toContain("Do me");
    expect(err.join("")).toBe("");
  });

  it("exits 2 when xbrief/plan.xbrief.json is corrupt", () => {
    const root = tempGitRepo();
    mkdirSync(join(root, "xbrief"), { recursive: true });
    writeFileSync(join(root, "xbrief", "plan.xbrief.json"), "{ not json");
    const code = run(["--project-root", root]);
    expect(code).toBe(2);
  });

  it("--json prints the found item on stdout with exit 0", () => {
    const root = tempGitRepo();
    const rel = writeScopeFixture(root, "pending", "2026-01-01-do-me.xbrief.json", {
      title: "Do me",
      status: "pending",
    });
    const code = run(["--project-root", root, "--json"]);
    expect(code).toBe(0);
    const payload = JSON.parse(out.join(""));
    expect(payload).toEqual({ ok: true, path: rel, status: "pending", title: "Do me" });
  });

  it("--json reports empty on stdout with exit 1", () => {
    const root = tempGitRepo();
    const code = run(["--project-root", root, "--json"]);
    expect(code).toBe(1);
    expect(err.join("")).toBe("");
    const payload = JSON.parse(out.join(""));
    expect(payload).toEqual({ empty: true, ok: true });
  });
});
