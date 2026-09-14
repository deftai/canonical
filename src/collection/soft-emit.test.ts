import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { cleanupTempDirs, tempDir } from "../test-support/index.js";
import * as emit from "./emit.js";
import {
  drainSoftEmits,
  LATE_EMIT_GRACE_MS,
  resetPendingSoftEmitsForTests,
  SOFT_EMIT_TIMEOUT_MS,
  softEmitUsage,
} from "./soft-emit.js";

afterAll(() => cleanupTempDirs());

describe("softEmitUsage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    resetPendingSoftEmitsForTests();
  });

  it("returns true when emit completes within the soft timeout", async () => {
    const root = tempDir("canon-soft-emit-ok-");
    vi.spyOn(emit, "emitUsage").mockResolvedValue({ emitted: true, id: "m-1" });
    await expect(softEmitUsage(root, "orient_ok")).resolves.toBe(true);
  });

  it("clears soft timeout when emit completes quickly (Greptile P2)", async () => {
    vi.useFakeTimers();
    const root = tempDir("canon-soft-emit-fast-");
    vi.spyOn(emit, "emitUsage").mockResolvedValue({ emitted: true, id: "m-1" });

    await expect(softEmitUsage(root, "orient_ok")).resolves.toBe(true);
    expect(vi.getTimerCount()).toBe(0);
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
    await drainSoftEmits();
    expect(lateCalled).toBe(true);
  });

  it("swallows onLateEmit throws and late emit rejections (Greptile P1)", async () => {
    vi.useFakeTimers();
    const root = tempDir("canon-soft-emit-throw-");
    vi.spyOn(emit, "emitUsage").mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve({ emitted: true, id: "late-1" }), SOFT_EMIT_TIMEOUT_MS + 100);
        }),
    );

    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);

    const promise = softEmitUsage(root, "xbrief_inventory", 1, undefined, {
      onLateEmit: () => {
        throw new Error("disk full");
      },
    });

    await vi.advanceTimersByTimeAsync(SOFT_EMIT_TIMEOUT_MS);
    expect(await promise).toBe(false);

    await vi.advanceTimersByTimeAsync(200);
    await drainSoftEmits();
    process.off("unhandledRejection", onUnhandled);
    expect(unhandled).toEqual([]);
  });

  it("drainSoftEmits waits for late success before CLI would exit (Greptile P2)", async () => {
    vi.useFakeTimers();
    const root = tempDir("canon-soft-emit-drain-");
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

    const drain = drainSoftEmits();
    await vi.advanceTimersByTimeAsync(200);
    await drain;
    expect(lateCalled).toBe(true);
  });

  it("clears drain fallback timer when late emits settle early (Greptile P2)", async () => {
    vi.useFakeTimers();
    const root = tempDir("canon-soft-emit-drain-early-");
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

    const drain = drainSoftEmits();
    await vi.advanceTimersByTimeAsync(200);
    await drain;
    expect(lateCalled).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("drain waits at most LATE_EMIT_GRACE_MS after soft timeout (Greptile P1)", async () => {
    vi.useFakeTimers();
    const root = tempDir("canon-soft-emit-grace-");
    vi.spyOn(emit, "emitUsage").mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve({ emitted: true, id: "late-1" }), SOFT_EMIT_TIMEOUT_MS + 400);
        }),
    );

    const promise = softEmitUsage(root, "xbrief_inventory");
    await vi.advanceTimersByTimeAsync(SOFT_EMIT_TIMEOUT_MS);
    expect(await promise).toBe(false);

    const drain = drainSoftEmits();
    await vi.advanceTimersByTimeAsync(LATE_EMIT_GRACE_MS);
    await drain;
    expect(vi.getTimerCount()).toBe(0);
  });
});
