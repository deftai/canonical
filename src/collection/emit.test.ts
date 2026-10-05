/**
 * MET-10 soft-emit / drain budgets against the fake collector (no emit mocks).
 * softEmitUsage + drainSoftEmits come from the barrel so they survive soft-emit.ts → emit.ts.
 * MET-8 late-success inventory throttle is re-proved here (orient wires the same onLateEmit).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import {
  canon,
  cleanupTempDirs,
  installCollectionHarness,
  installCollectionTestHooks,
} from "../test-support/index.js";
import {
  drainSoftEmits,
  markInventoryEmitted,
  resetPendingSoftEmitsForTests,
  softEmitUsage,
} from "./index.js";

installCollectionTestHooks();
afterAll(() => cleanupTempDirs());

/** Hardcoded so mutating SOFT_EMIT_TIMEOUT_MS / LATE_EMIT_GRACE_MS breaks these. */
const SOFT_BUDGET_MS = 2_500;
const DRAIN_GRACE_MS = 500;

async function optInAnonymous(root: string): Promise<void> {
  const result = await canon(["collection:opt-in", "--confirm"], { cwd: root });
  expect(result.code).toBe(0);
}

describe("MET-10 soft emit (fake collector)", () => {
  it("MET-10: soft emit returns true when the collector answers within 2500ms", async () => {
    const { root } = installCollectionHarness();
    await optInAnonymous(root);
    vi.useFakeTimers();
    const done = softEmitUsage(root, "orient_ok");
    await vi.advanceTimersByTimeAsync(0);
    await expect(done).resolves.toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("MET-10: soft emit clears its timer when emit rejects before the deadline", async () => {
    const { root, fake } = installCollectionHarness();
    await optInAnonymous(root);
    vi.useFakeTimers();
    fake.failNext("challenge", "internal_error");
    const done = softEmitUsage(root, "orient_ok");
    await vi.advanceTimersByTimeAsync(0);
    await expect(done).resolves.toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("MET-8: inventory throttle advances when soft emit succeeds after the soft timeout", async () => {
    const { root, fake } = installCollectionHarness();
    await optInAnonymous(root);
    const inventoryPath = join(root, ".canonical", "collection-inventory.json");
    expect(existsSync(inventoryPath)).toBe(false);

    vi.useFakeTimers();
    fake.hangNext("submissions", SOFT_BUDGET_MS + 100);

    const promise = softEmitUsage(root, "xbrief_inventory", 1, undefined, {
      onLateEmit: () => markInventoryEmitted(root),
    });
    await vi.advanceTimersByTimeAsync(SOFT_BUDGET_MS);
    expect(await promise).toBe(false);
    expect(existsSync(inventoryPath)).toBe(false);

    await vi.advanceTimersByTimeAsync(200);
    await drainSoftEmits();
    expect(existsSync(inventoryPath)).toBe(true);
    expect(
      (JSON.parse(readFileSync(inventoryPath, "utf8")) as { lastInventoryEmittedAt: number })
        .lastInventoryEmittedAt,
    ).toBeGreaterThan(0);
  });

  it("MET-10: soft emit times out after 2500ms (hardcoded budget)", async () => {
    const { root, fake } = installCollectionHarness();
    await optInAnonymous(root);

    vi.useFakeTimers();
    fake.hangNext("submissions", SOFT_BUDGET_MS + 10_000);

    const promise = softEmitUsage(root, "orient_ok");
    await vi.advanceTimersByTimeAsync(SOFT_BUDGET_MS);
    expect(await promise).toBe(false);
    resetPendingSoftEmitsForTests();
  });

  it("MET-10: calls onLateEmit when emit succeeds after the 2500ms soft timeout", async () => {
    const { root, fake } = installCollectionHarness();
    await optInAnonymous(root);

    vi.useFakeTimers();
    fake.hangNext("submissions", SOFT_BUDGET_MS + 100);

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

  it("MET-10: swallows onLateEmit throws (never leaves an unhandled rejection)", async () => {
    const { root, fake } = installCollectionHarness();
    await optInAnonymous(root);

    vi.useFakeTimers();
    fake.hangNext("submissions", SOFT_BUDGET_MS + 100);

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
    const { root, fake } = installCollectionHarness();
    await optInAnonymous(root);

    vi.useFakeTimers();
    fake.hangNext("submissions", SOFT_BUDGET_MS + DRAIN_GRACE_MS + 5_000);

    const promise = softEmitUsage(root, "xbrief_inventory");
    await vi.advanceTimersByTimeAsync(SOFT_BUDGET_MS);
    expect(await promise).toBe(false);

    let drainDone = false;
    const drain = drainSoftEmits().then(() => {
      drainDone = true;
    });
    await vi.advanceTimersByTimeAsync(DRAIN_GRACE_MS);
    await drain;
    expect(drainDone).toBe(true);
    resetPendingSoftEmitsForTests();
  });

  it("MET-10: drain clears fallback timer when late emits settle within 500ms grace", async () => {
    const { root, fake } = installCollectionHarness();
    await optInAnonymous(root);

    vi.useFakeTimers();
    fake.hangNext("submissions", SOFT_BUDGET_MS + 100);

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

  it("MET-10: soft emit returns false on transport failure without throwing", async () => {
    const { root, fake } = installCollectionHarness();
    await optInAnonymous(root);
    fake.failNext("challenge", "internal_error");
    await expect(softEmitUsage(root, "orient_ok")).resolves.toBe(false);
  });
});
