import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupTempDirs, git, tempGitRepo, writeScopeFixture } from "../test-support/index.js";
import { run } from "./scope-start.js";

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

function commitAll(root: string): void {
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "fixture");
}

describe("canon scope:start", () => {
  it("too many positional args is an arg error (exit 2)", () => {
    const root = tempGitRepo();
    const code = run(["a.json", "b.json", "--project-root", root]);
    expect(code).toBe(2);
  });

  it("missing scope argument is an arg error (exit 2)", () => {
    const root = tempGitRepo();
    const code = run(["--project-root", root]);
    expect(code).toBe(2);
  });

  it("happy path returns 0 and --json emits sorted snake_case", () => {
    const root = tempGitRepo();
    git(root, "checkout", "-q", "-b", "feature/foo");
    writeScopeFixture(root, "proposed", "2026-01-01-foo.json");
    commitAll(root);

    const code = run(["2026-01-01-foo.json", "--project-root", root, "--json"]);

    expect(code).toBe(0);
    const printed = (outSpy.mock.calls[0]?.[0] as string) ?? "";
    const parsed = JSON.parse(printed);
    expect(parsed).toMatchObject({ ok: true, status: "running" });
    expect(Object.keys(parsed)).toEqual([...Object.keys(parsed)].sort());
  });

  it("gate failure (default branch) returns 1", () => {
    const root = tempGitRepo();
    writeScopeFixture(root, "pending", "2026-01-01-foo.json", {
      plan: {
        status: "pending",
        created: "2026-01-01T00:00:00.000Z",
        updated: "2026-01-01T00:00:00.000Z",
      },
    });
    commitAll(root);

    const code = run(["2026-01-01-foo.json", "--project-root", root]);

    expect(code).toBe(1);
  });
});
