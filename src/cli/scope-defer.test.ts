import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as collection from "../collection/index.js";
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
  it("parks a pending scope in deferred/ and returns 0", async () => {
    const root = tempGitRepo();
    writeScopeFixture(root, "pending", "2026-01-01-foo.json", statusPlan("pending"));

    const code = await run(["2026-01-01-foo.json", "--project-root", root, "--json"]);

    expect(code).toBe(0);
    const parsed = JSON.parse((outSpy.mock.calls[0]?.[0] as string) ?? "");
    expect(parsed).toMatchObject({ ok: true, status: "approved" });
  });

  it("emits xbrief_scope_stop telemetry with defer action (#16)", async () => {
    const root = tempGitRepo();
    writeScopeFixture(root, "pending", "2026-01-01-foo.json", statusPlan("pending"));
    const emitSpy = vi.spyOn(collection, "softEmitUsage").mockResolvedValue(true);

    const code = await run(["2026-01-01-foo.json", "--project-root", root]);

    expect(code).toBe(0);
    expect(emitSpy).toHaveBeenCalledWith(
      root,
      "xbrief_scope_stop",
      1,
      expect.objectContaining({ action: "defer" }),
    );
    emitSpy.mockRestore();
  });

  it("missing scope argument is an arg error (exit 2)", async () => {
    const root = tempGitRepo();
    const code = await run(["--project-root", root]);
    expect(code).toBe(2);
  });
});
