import { afterAll, describe, expect, it } from "vitest";
import { cleanupTempDirs, tempDir } from "../test-support/index.js";
import {
  buildSessionSummaryDimensions,
  bumpAgentTurn,
  clearSession,
  readSession,
  recordCheckRun,
  recordScopeCompleted,
  recordScopeCreated,
  shouldEmitInventory,
  writeSession,
} from "./session-state.js";

afterAll(() => cleanupTempDirs());

describe("session-state (#9)", () => {
  it("persists and builds session_summary dimensions", () => {
    const root = tempDir("canon-session-");
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

  it("clearSession removes persisted counters", () => {
    const root = tempDir("canon-session-clear-");
    bumpAgentTurn(root);
    expect(readSession(root)).toBeDefined();
    clearSession(root);
    expect(readSession(root)).toBeUndefined();
    expect(buildSessionSummaryDimensions(root)).toBeUndefined();
  });

  it("shouldEmitInventory respects 24h throttle", () => {
    const root = tempDir("canon-session-inv-");
    const now = Date.now();
    writeSession(root, {
      sessionId: "s",
      startedAt: new Date(now).toISOString(),
      agentTurns: 0,
      scopesCreated: 0,
      scopesCompleted: 0,
      scopesCancelled: 0,
      consentPrompts: 0,
      checksRun: 0,
      lastInventoryEmittedAt: now - 60_000,
    });
    expect(shouldEmitInventory(root, new Date(now))).toBe(false);
    expect(shouldEmitInventory(root, new Date(now + 25 * 60 * 60 * 1000))).toBe(true);
  });
});
