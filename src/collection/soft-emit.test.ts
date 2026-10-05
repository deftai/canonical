import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { cleanupTempDirs, tempDir } from "../test-support/index.js";
import * as emit from "./emit.js";
import { drainSoftEmits, resetPendingSoftEmitsForTests, softEmitUsage } from "./soft-emit.js";

afterAll(() => cleanupTempDirs());

/** MET-10 budgets — hardcoded so mutating SOFT_EMIT_TIMEOUT_MS / LATE_EMIT_GRACE_MS breaks these. */
const SOFT_BUDGET_MS = 2_500;
const DRAIN_GRACE_MS = 500;

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

  it("clears soft timeout when emit rejects before deadline (Greptile P2)", async () => {
    vi.useFakeTimers();
    const root = tempDir("canon-soft-emit-reject-");
    vi.spyOn(emit, "emitUsage").mockRejectedValue(new Error("collector down"));

    await expect(softEmitUsage(root, "orient_ok")).resolves.toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("MET-10: soft emit times out after 2500ms (hardcoded budget)", async () => {
    vi.useFakeTimers();
    const root = tempDir("canon-soft-emit-budget-");
    vi.spyOn(emit, "emitUsage").mockImplementation(
      () =>
        new Promise((resolve) => {
          // Completes well after the required 2.5s soft budget.
          setTimeout(() => resolve({ emitted: true, id: "late-1" }), SOFT_BUDGET_MS + 10_000);
        }),
    );

    const promise = softEmitUsage(root, "orient_ok");
    await vi.advanceTimersByTimeAsync(SOFT_BUDGET_MS);
    expect(await promise).toBe(false);
  });

  it("MET-10: calls onLateEmit when emit succeeds after the 2500ms soft timeout", async () => {
    vi.useFakeTimers();
    const root = tempDir("canon-soft-emit-late-");
    vi.spyOn(emit, "emitUsage").mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve({ emitted: true, id: "late-1" }), SOFT_BUDGET_MS + 100);
        }),
    );

    let lateCalled = false;
    const promise = softEmitUsage(root, "xbrief_inventory", 1, undefined, {
      onLateEmit: () => {
        lateCalled = true;
      },
    });

    await vi.advanceTimersByTimeAsync(SOFT_BUDGET_MS);
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
          setTimeout(() => resolve({ emitted: true, id: "late-1" }), SOFT_BUDGET_MS + 100);
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

    await vi.advanceTimersByTimeAsync(SOFT_BUDGET_MS);
    expect(await promise).toBe(false);

    await vi.advanceTimersByTimeAsync(200);
    await drainSoftEmits();
    process.off("unhandledRejection", onUnhandled);
    expect(unhandled).toEqual([]);
  });

  it("MET-10: drainSoftEmits waits at most 500ms beyond the 2500ms soft timeout", async () => {
    vi.useFakeTimers();
    const root = tempDir("canon-soft-emit-grace-");
    let settled = false;
    vi.spyOn(emit, "emitUsage").mockImplementation(
      () =>
        new Promise((resolve) => {
          // Settles after soft timeout + grace — drain must not wait for it.
          setTimeout(
            () => {
              settled = true;
              resolve({ emitted: true, id: "late-1" });
            },
            SOFT_BUDGET_MS + DRAIN_GRACE_MS + 5_000,
          );
        }),
    );

    const promise = softEmitUsage(root, "xbrief_inventory");
    await vi.advanceTimersByTimeAsync(SOFT_BUDGET_MS);
    expect(await promise).toBe(false);

    const drain = drainSoftEmits();
    await vi.advanceTimersByTimeAsync(DRAIN_GRACE_MS);
    await drain;
    // Drain returned at the 500ms grace bound; the late emit has not settled yet.
    expect(settled).toBe(false);
  });

  it("MET-10: drain clears fallback timer when late emits settle within 500ms grace", async () => {
    vi.useFakeTimers();
    const root = tempDir("canon-soft-emit-drain-early-");
    vi.spyOn(emit, "emitUsage").mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve({ emitted: true, id: "late-1" }), SOFT_BUDGET_MS + 100);
        }),
    );

    let lateCalled = false;
    const promise = softEmitUsage(root, "xbrief_inventory", 1, undefined, {
      onLateEmit: () => {
        lateCalled = true;
      },
    });

    await vi.advanceTimersByTimeAsync(SOFT_BUDGET_MS);
    expect(await promise).toBe(false);

    const drain = drainSoftEmits();
    await vi.advanceTimersByTimeAsync(200);
    await drain;
    expect(lateCalled).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
