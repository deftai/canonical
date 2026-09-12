import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { atomicWriteJson } from "../fs/index.js";
import { cleanupTempDirs, tempGitRepo, writeScopeFixture } from "../test-support/index.js";
import { run } from "./triage.js";

afterAll(() => {
  cleanupTempDirs();
});

let outSpy: ReturnType<typeof vi.spyOn>;
let errSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  outSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(() => {
  outSpy.mockRestore();
  errSpy.mockRestore();
});

describe("canon triage", async () => {
  it("bad verb is an arg error (exit 2)", async () => {
    const root = tempGitRepo();
    const code = await run(["nope", "foo.json", "--project-root", root]);
    expect(code).toBe(2);
    expect(errSpy).toHaveBeenCalled();
  });

  it("missing scope argument is an arg error (exit 2)", async () => {
    const root = tempGitRepo();
    const code = await run(["accept", "--project-root", root]);
    expect(code).toBe(2);
  });

  it("happy path: accept prints status and returns 0, --json emits sorted snake_case", async () => {
    const root = tempGitRepo();
    writeScopeFixture(root, "proposed", "2026-01-01-foo.xbrief.json");

    const code = await run([
      "accept",
      "2026-01-01-foo.xbrief.json",
      "--project-root",
      root,
      "--json",
    ]);

    expect(code).toBe(0);
    const printed = (outSpy.mock.calls[0]?.[0] as string) ?? "";
    const parsed = JSON.parse(printed);
    expect(parsed).toMatchObject({ ok: true, verb: "accept", status: "pending" });
    expect(Object.keys(parsed)).toEqual([...Object.keys(parsed)].sort());
  });

  it("gate failure (WIP cap) returns 1", async () => {
    const root = tempGitRepo();
    atomicWriteJson(root, "xbrief/PROJECT.xbrief.json", {
      xBRIEFInfo: { version: "0.8" },
      plan: { title: "t", status: "running", items: [], "x-canonical/policy": { wipCap: 0 } },
    });
    writeScopeFixture(root, "proposed", "2026-01-01-foo.xbrief.json");

    const code = await run(["accept", "2026-01-01-foo.xbrief.json", "--project-root", root]);

    expect(code).toBe(1);
  });

  it("reject with --defer is an arg error (exit 2)", () => {
    const root = tempGitRepo();
    writeScopeFixture(root, "proposed", "2026-01-01-foo.xbrief.json");

    const code = run(["reject", "2026-01-01-foo.xbrief.json", "--defer", "--project-root", root]);

    expect(code).toBe(2);
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining("--defer is only valid with accept"),
    );
  });
});
