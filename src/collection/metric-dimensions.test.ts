import { afterAll, describe, expect, it } from "vitest";
import { cleanupTempDirs, tempGitRepo, writeScopeFixture } from "../test-support/index.js";
import type { ScopeDoc } from "../types/index.js";
import {
  bucketAgentTurns,
  bucketLifetimeHours,
  scopeCompleteDimensions,
  scopeCreatedDimensions,
  xbriefInventoryDimensions,
} from "./metric-dimensions.js";

afterAll(() => cleanupTempDirs());

function scopeDoc(overrides: Record<string, unknown> = {}): ScopeDoc {
  return {
    xBRIEFInfo: { version: "0.8" },
    plan: {
      title: "t",
      status: "running",
      created: "2026-01-01T12:00:00.000Z",
      updated: "2026-01-01T12:00:00.000Z",
      items: [
        { id: "a1", title: "one", status: "completed" },
        { id: "a2", title: "two", status: "pending" },
      ],
      "x-canonical/kind": "story",
      "x-canonical/dependencies": ["dep-a"],
      ...overrides,
    },
  } as ScopeDoc;
}

describe("metric-dimensions (#9)", () => {
  it("buckets lifetime hours", () => {
    const now = new Date("2026-01-01T12:30:00.000Z");
    expect(bucketLifetimeHours("2026-01-01T12:00:00.000Z", now)).toBe("<1");
    expect(bucketLifetimeHours("2026-01-01T09:00:00.000Z", now)).toBe("1-4");
    expect(bucketLifetimeHours("2026-01-01T00:00:00.000Z", now)).toBe("4-24");
    expect(bucketLifetimeHours("2025-12-30T12:00:00.000Z", now)).toBe("24+");
  });

  it("buckets agent turns", () => {
    expect(bucketAgentTurns(3)).toBe("1-5");
    expect(bucketAgentTurns(10)).toBe("6-15");
    expect(bucketAgentTurns(25)).toBe("16-40");
    expect(bucketAgentTurns(100)).toBe("40+");
  });

  it("builds scope_complete dimensions with acceptance counts", () => {
    const dims = scopeCompleteDimensions(scopeDoc(), {
      disposition: "accepted_not_delivered",
      hadDeliveryPr: false,
      now: new Date("2026-01-01T12:30:00.000Z"),
    });
    expect(dims).toEqual({
      kind: "story",
      acceptance_total: 2,
      acceptance_completed: 1,
      dependency_count: 1,
      disposition: "accepted_not_delivered",
      lifetime_hours: "<1",
    });
  });

  it("builds scope_created dimensions", () => {
    expect(scopeCreatedDimensions(scopeDoc({ status: "proposed", items: [] }))).toEqual({
      kind: "story",
      has_acceptance_count: 0,
      dependency_count: 1,
    });
  });

  it("xbrief_inventory counts folders and blocked status", () => {
    const root = tempGitRepo();
    writeScopeFixture(root, "proposed", "2026-01-01-a.xbrief.json", { status: "proposed" });
    writeScopeFixture(root, "active", "2026-01-01-b.xbrief.json", { status: "blocked" });
    writeScopeFixture(root, "active", "2026-01-01-c.xbrief.json", { status: "running" });
    expect(xbriefInventoryDimensions(root)).toEqual({
      proposed: 1,
      pending: 0,
      active: 2,
      completed: 0,
      cancelled: 0,
      blocked: 1,
    });
  });
});
