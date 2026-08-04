import { cleanupTempDirs, tempGitRepo, writeScopeFixture } from "@canonpack/core/test-support";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { run } from "./scope-complete.js";

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

describe("canon scope:complete", () => {
  it("missing scope argument is an arg error (exit 2)", async () => {
    const root = tempGitRepo();
    const code = await run(["--project-root", root]);
    expect(code).toBe(2);
  });

  it("happy path (non-code-bearing) returns 0 and --json emits sorted snake_case", async () => {
    const root = tempGitRepo();
    writeScopeFixture(root, "active", "2026-01-01-foo.json", {
      kind: "epic",
      plan: {
        status: "running",
        created: "2026-01-01T00:00:00.000Z",
        updated: "2026-01-01T00:00:00.000Z",
      },
    });

    const code = await run(["2026-01-01-foo.json", "--project-root", root, "--json"]);

    expect(code).toBe(0);
    const printed = (outSpy.mock.calls[0]?.[0] as string) ?? "";
    const parsed = JSON.parse(printed);
    expect(parsed).toMatchObject({ ok: true, status: "completed" });
    expect(Object.keys(parsed)).toEqual([...Object.keys(parsed)].sort());
  });

  it("gate failure: story without --disposition returns 1", async () => {
    const root = tempGitRepo();
    writeScopeFixture(root, "active", "2026-01-01-foo.json", {
      kind: "story",
      plan: {
        status: "running",
        created: "2026-01-01T00:00:00.000Z",
        updated: "2026-01-01T00:00:00.000Z",
      },
    });

    const code = await run(["2026-01-01-foo.json", "--project-root", root]);

    expect(code).toBe(1);
  });

  it("invalid --disposition value returns 2", async () => {
    const root = tempGitRepo();
    writeScopeFixture(root, "active", "2026-01-01-foo.json", {
      kind: "story",
      plan: {
        status: "running",
        created: "2026-01-01T00:00:00.000Z",
        updated: "2026-01-01T00:00:00.000Z",
      },
    });

    const code = await run([
      "2026-01-01-foo.json",
      "--project-root",
      root,
      "--disposition",
      "shipped",
    ]);

    expect(code).toBe(2);
  });
});
