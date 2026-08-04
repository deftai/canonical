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

describe("canon triage", () => {
  it("bad verb is an arg error (exit 2)", () => {
    const root = tempGitRepo();
    const code = run(["nope", "foo.json", "--project-root", root]);
    expect(code).toBe(2);
    expect(errSpy).toHaveBeenCalled();
  });

  it("missing scope argument is an arg error (exit 2)", () => {
    const root = tempGitRepo();
    const code = run(["accept", "--project-root", root]);
    expect(code).toBe(2);
  });

  it("happy path: accept prints status and returns 0, --json emits sorted snake_case", () => {
    const root = tempGitRepo();
    writeScopeFixture(root, "proposed", "2026-01-01-foo.json");

    const code = run(["accept", "2026-01-01-foo.json", "--project-root", root, "--json"]);

    expect(code).toBe(0);
    const printed = (outSpy.mock.calls[0]?.[0] as string) ?? "";
    const parsed = JSON.parse(printed);
    expect(parsed).toMatchObject({ ok: true, verb: "accept", status: "pending" });
    expect(Object.keys(parsed)).toEqual([...Object.keys(parsed)].sort());
  });

  it("gate failure (WIP cap) returns 1", () => {
    const root = tempGitRepo();
    atomicWriteJson(root, "briefs/PROJECT.json", { title: "t", policy: { wipCap: 0 } });
    writeScopeFixture(root, "proposed", "2026-01-01-foo.json");

    const code = run(["accept", "2026-01-01-foo.json", "--project-root", root]);

    expect(code).toBe(1);
  });
});
