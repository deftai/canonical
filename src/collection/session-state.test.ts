import { afterAll, describe, expect, it } from "vitest";
import { cleanupTempDirs, tempDir } from "../test-support/index.js";
import {
  buildSessionSummaryDimensions,
  bumpAgentTurn,
  clearSession,
  markInventoryEmitted,
  readSession,
  recordCheckRun,
  recordScopeCompleted,
  recordScopeCreated,
  shouldEmitInventory,
} from "./session-state.js";
import { writeMetricsMirror } from "./storage.js";

afterAll(() => cleanupTempDirs());

function grantUsage(root: string): void {
  writeMetricsMirror(root, {
    decision: "active",
    scopes: ["usage"],
    consentVersion: "canonical-2026-09-b",
    decidedAt: "2026-08-01T00:00:00.000Z",
    expiresAt: Date.now() + 86_400_000,
  });
}

describe("session-state (#9)", () => {
  it("persists and builds session_summary dimensions when usage consented", () => {
    const root = tempDir("canon-session-");
    grantUsage(root);
    bumpAgentTurn(root);
    bumpAgentTurn(root);
    recordScopeCreated(root);
    recordScopeCompleted(root);
    recordCheckRun(root);

    const dims = buildSessionSummaryDimensions(root, new Date("2026-01-01T04:00:00.000Z"));
    expect(dims).toMatchObject({
      agent_turns_bucket: "1-5",
      scopes_created: 1,
      scopes_completed: 1,
      checks_run: 1,
      duration_bucket: "<1",
    });
  });

  it("does not persist counters before usage consent", () => {
    const root = tempDir("canon-session-noconsent-");
    expect(bumpAgentTurn(root)).toBeUndefined();
    expect(recordScopeCreated(root)).toBeUndefined();
    expect(readSession(root)).toBeUndefined();
    expect(buildSessionSummaryDimensions(root)).toBeUndefined();
  });

  it("clearSession removes persisted counters but keeps inventory throttle", () => {
    const root = tempDir("canon-session-clear-");
    grantUsage(root);
    bumpAgentTurn(root);
    const now = Date.now();
    markInventoryEmitted(root, new Date(now));
    expect(readSession(root)).toBeDefined();
    clearSession(root);
    expect(readSession(root)).toBeUndefined();
    expect(buildSessionSummaryDimensions(root)).toBeUndefined();
    expect(shouldEmitInventory(root, new Date(now + 60_000))).toBe(false);
  });

  it("shouldEmitInventory respects 24h throttle via inventory file", () => {
    const root = tempDir("canon-session-inv-");
    const now = Date.now();
    markInventoryEmitted(root, new Date(now - 60_000));
    expect(shouldEmitInventory(root, new Date(now))).toBe(false);
    expect(shouldEmitInventory(root, new Date(now + 25 * 60 * 60 * 1000))).toBe(true);
  });
});
