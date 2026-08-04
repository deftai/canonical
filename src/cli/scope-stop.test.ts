import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupTempDirs, tempGitRepo, writeScopeFixture } from "../test-support/index.js";
import { run } from "./scope-stop.js";

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

function statusPlan(status: string) {
  return { status, created: "2026-01-01T00:00:00.000Z", updated: "2026-01-01T00:00:00.000Z" };
}

describe("canon scope:stop", () => {
  it("no mode flag is an arg error (exit 2)", () => {
    const root = tempGitRepo();
    writeScopeFixture(root, "pending", "2026-01-01-foo.json", { plan: statusPlan("pending") });
    const code = run(["2026-01-01-foo.json", "--project-root", root]);
    expect(code).toBe(2);
  });

  it("two mode flags is an arg error (exit 2)", () => {
    const root = tempGitRepo();
    writeScopeFixture(root, "pending", "2026-01-01-foo.json", { plan: statusPlan("pending") });
    const code = run(["2026-01-01-foo.json", "--cancel", "--fail", "--project-root", root]);
    expect(code).toBe(2);
  });

  it("missing scope argument is an arg error (exit 2)", () => {
    const root = tempGitRepo();
    const code = run(["--cancel", "--project-root", root]);
    expect(code).toBe(2);
  });

  it("happy path (cancel) returns 0 and --json emits sorted snake_case", () => {
    const root = tempGitRepo();
    writeScopeFixture(root, "pending", "2026-01-01-foo.json", { plan: statusPlan("pending") });

    const code = run(["2026-01-01-foo.json", "--cancel", "--project-root", root, "--json"]);

    expect(code).toBe(0);
    const printed = (outSpy.mock.calls[0]?.[0] as string) ?? "";
    const parsed = JSON.parse(printed);
    expect(parsed).toMatchObject({ ok: true, status: "cancelled" });
    expect(Object.keys(parsed)).toEqual([...Object.keys(parsed)].sort());
  });

  it("illegal transition (fail from pending) returns 1", () => {
    const root = tempGitRepo();
    writeScopeFixture(root, "pending", "2026-01-01-foo.json", { plan: statusPlan("pending") });

    const code = run(["2026-01-01-foo.json", "--fail", "--project-root", root]);

    expect(code).toBe(1);
  });
});
