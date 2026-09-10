import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupTempDirs, tempGitRepo, writeScopeFixture } from "../test-support/index.js";
import { run } from "./scope-defer.js";

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

describe("canon scope:defer", () => {
  it("parks a pending scope in deferred/ and returns 0", () => {
    const root = tempGitRepo();
    writeScopeFixture(root, "pending", "2026-01-01-foo.json", statusPlan("pending"));

    const code = run(["2026-01-01-foo.json", "--project-root", root, "--json"]);

    expect(code).toBe(0);
    const parsed = JSON.parse((outSpy.mock.calls[0]?.[0] as string) ?? "");
    expect(parsed).toMatchObject({ ok: true, status: "approved" });
  });

  it("missing scope argument is an arg error (exit 2)", () => {
    const root = tempGitRepo();
    const code = run(["--project-root", root]);
    expect(code).toBe(2);
  });
});
