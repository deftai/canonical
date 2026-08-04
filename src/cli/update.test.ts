import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupTempDirs, tempGitRepo } from "../test-support/index.js";
import { run as runInitCli } from "./init.js";
import { run } from "./update.js";

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

describe("canon update", () => {
  it("exits 2 with a helpful message when there is no prior init", () => {
    const root = tempGitRepo({ withBriefs: false });
    const code = run(["--project-root", root]);
    expect(code).toBe(2);
    expect(err).toContain("canon init");
  });

  it("re-stamps VERSION after a prior init and exits 0", () => {
    const root = tempGitRepo({ withBriefs: false });
    runInitCli(["--project-root", root]);
    const code = run(["--project-root", root]);
    expect(code).toBe(0);
    const version = readFileSync(join(root, ".canonical", "core", "VERSION"), "utf8");
    expect(version).toContain("fetched_by: canon-update");
  });

  it("--json prints a single-line JSON summary", () => {
    const root = tempGitRepo({ withBriefs: false });
    runInitCli(["--project-root", root]);
    out = "";
    const code = run(["--project-root", root, "--json"]);
    expect(code).toBe(0);
    const parsed = JSON.parse(out.trim());
    expect(parsed).toHaveProperty("written");
  });
});
