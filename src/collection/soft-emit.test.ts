import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { cleanupTempDirs, tempDir } from "../test-support/index.js";
import * as emit from "./emit.js";
import { SOFT_EMIT_TIMEOUT_MS, softEmitUsage } from "./soft-emit.js";

afterAll(() => cleanupTempDirs());

describe("softEmitUsage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("returns true when emit completes within the soft timeout", async () => {
    const root = tempDir("canon-soft-emit-ok-");
    vi.spyOn(emit, "emitUsage").mockResolvedValue({ emitted: true, id: "m-1" });
    await expect(softEmitUsage(root, "orient_ok")).resolves.toBe(true);
  });

  it("calls onLateEmit when emit succeeds after the soft timeout (#18)", async () => {
    vi.useFakeTimers();
    const root = tempDir("canon-soft-emit-late-");
    vi.spyOn(emit, "emitUsage").mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve({ emitted: true, id: "late-1" }), SOFT_EMIT_TIMEOUT_MS + 100);
        }),
    );

    let lateCalled = false;
    const promise = softEmitUsage(root, "xbrief_inventory", 1, undefined, {
      onLateEmit: () => {
        lateCalled = true;
      },
    });

    await vi.advanceTimersByTimeAsync(SOFT_EMIT_TIMEOUT_MS);
    expect(await promise).toBe(false);
    expect(lateCalled).toBe(false);

    await vi.advanceTimersByTimeAsync(200);
    await Promise.resolve();
    expect(lateCalled).toBe(true);
  });
});
