import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cleanupTempDirs, tempGitRepo } from "../test-support/index.js";
import { checkLease, registerLease, releaseLease, reviewMonitorPath } from "./index.js";

afterAll(() => {
  cleanupTempDirs();
});

describe("review-monitor lease lifecycle", () => {
  it("check reports 1 (none) before any registration", () => {
    const root = tempGitRepo({ withBriefs: false });
    expect(checkLease(root, 42).code).toBe(1);
  });

  it("register then check reports 0 (active) with the owner", () => {
    const root = tempGitRepo({ withBriefs: false });
    const reg = registerLease(root, 42, "alice");
    expect(reg.code).toBe(0);
    expect(reg.lease).toMatchObject({ pr: 42, owner: "alice" });

    const check = checkLease(root, 42);
    expect(check.code).toBe(0);
    expect(check.lease?.owner).toBe("alice");
  });

  it("registering again for the same pr replaces the existing lease, not appends", () => {
    const root = tempGitRepo({ withBriefs: false });
    registerLease(root, 42, "alice");
    registerLease(root, 42, "bob");

    const state = JSON.parse(readFileSync(reviewMonitorPath(root), "utf8"));
    expect(state.leases).toHaveLength(1);
    expect(state.leases[0].owner).toBe("bob");
  });

  it("release removes the lease; check then reports 1", () => {
    const root = tempGitRepo({ withBriefs: false });
    registerLease(root, 42, "alice");
    const rel = releaseLease(root, 42);
    expect(rel.code).toBe(0);
    expect(rel.released).toBe(true);
    expect(checkLease(root, 42).code).toBe(1);
  });

  it("releasing a pr with no lease is not an error, and reports released: false", () => {
    const root = tempGitRepo({ withBriefs: false });
    const rel = releaseLease(root, 99);
    expect(rel.code).toBe(0);
    expect(rel.released).toBe(false);
  });

  it("leases for distinct PRs coexist", () => {
    const root = tempGitRepo({ withBriefs: false });
    registerLease(root, 1, "alice");
    registerLease(root, 2, "bob");
    expect(checkLease(root, 1).lease?.owner).toBe("alice");
    expect(checkLease(root, 2).lease?.owner).toBe("bob");
  });

  it("errors (2) on a malformed review-monitor.json", () => {
    const root = tempGitRepo({ withBriefs: false });
    mkdirSync(dirname(reviewMonitorPath(root)), { recursive: true });
    writeFileSync(reviewMonitorPath(root), "not json");
    expect(checkLease(root, 1).code).toBe(2);
    expect(registerLease(root, 1, "alice").code).toBe(2);
    expect(releaseLease(root, 1).code).toBe(2);
  });
});
