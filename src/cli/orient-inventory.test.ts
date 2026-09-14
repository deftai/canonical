import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import * as collection from "../collection/index.js";
import { cleanupTempDirs, tempGitRepo } from "../test-support/index.js";
import { run } from "./orient.js";

afterAll(() => cleanupTempDirs());

describe("orient inventory throttle", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("marks inventory emitted via onLateEmit when soft emit times out then succeeds (#18)", async () => {
    const root = tempGitRepo();
    vi.spyOn(collection, "shouldEmitInventory").mockReturnValue(true);
    const markSpy = vi.spyOn(collection, "markInventoryEmitted").mockImplementation(() => {});
    vi.spyOn(collection, "softEmitUsage").mockImplementation(
      async (_root, _metric, _value, _dims, opts) => {
        opts?.onLateEmit?.();
        return false;
      },
    );

    const code = await run(["--project-root", root, "--allow-dirty"]);
    expect(code).toBe(0);
    expect(markSpy).toHaveBeenCalledWith(root);
  });
});
