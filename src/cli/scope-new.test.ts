import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupTempDirs, tempGitRepo } from "../test-support/index.js";
import { run } from "./scope-new.js";

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

describe("scope-new handler", () => {
  it("exits 2 when the title positional is missing", () => {
    const root = tempGitRepo();
    const code = run(["--project-root", root]);
    expect(code).toBe(2);
    expect(err.join("")).toContain("missing required <title>");
  });

  it("exits 2 on an unknown flag", () => {
    const code = run(["--bogus", "Some title"]);
    expect(code).toBe(2);
  });

  it("exits 2 when --project-root does not exist", () => {
    const code = run(["--project-root", "/no/such/directory/at/all", "Some title"]);
    expect(code).toBe(2);
    expect(err.join("")).toContain("project root not found");
  });

  it("exits 0, writes a valid proposed scope, and prints its path", () => {
    const root = tempGitRepo();
    const code = run(["--project-root", root, "Fix the widget loader"]);
    expect(code).toBe(0);
    const printed = out.join("").trim();
    expect(printed).toMatch(/^briefs\/proposed\/\d{4}-\d{2}-\d{2}-fix-the-widget-loader\.json$/);
    expect(existsSync(join(root, printed))).toBe(true);

    const written = JSON.parse(readFileSync(join(root, printed), "utf8")) as {
      title: string;
      kind: string;
      plan: { status: string };
    };
    expect(written.title).toBe("Fix the widget loader");
    expect(written.kind).toBe("story");
    expect(written.plan.status).toBe("proposed");
  });

  it("exits 1 on slug collision and prints the existing path", () => {
    const root = tempGitRepo();
    const first = run(["--project-root", root, "Duplicate title"]);
    expect(first).toBe(0);
    out.length = 0;

    const second = run(["--project-root", root, "Duplicate title"]);
    expect(second).toBe(1);
    expect(out.join("")).toBe("");
    expect(err.join("")).toContain("slug collision");
    expect(err.join("")).toMatch(/briefs\/proposed\/\d{4}-\d{2}-\d{2}-duplicate-title\.json/);
  });

  it("--json prints a JSON payload with the created path on success", () => {
    const root = tempGitRepo();
    const code = run(["--project-root", root, "--json", "JSON created scope"]);
    expect(code).toBe(0);
    const payload = JSON.parse(out.join(""));
    expect(payload.ok).toBe(true);
    expect(payload.path).toMatch(/^briefs\/proposed\/.*json-created-scope\.json$/);
    expect(payload.status).toBe("proposed");
  });

  it("--json reports the collision on stdout with exit 1", () => {
    const root = tempGitRepo();
    run(["--project-root", root, "Collide me"]);
    out.length = 0;
    const code = run(["--project-root", root, "--json", "Collide me"]);
    expect(code).toBe(1);
    expect(err.join("")).toBe("");
    const payload = JSON.parse(out.join(""));
    expect(payload.ok).toBe(false);
    expect(payload.code).toBe("slug-collision");
    expect(payload.existing_path).toMatch(/collide-me\.json$/);
  });
});
