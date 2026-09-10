import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { readSession, SESSION_FILE_REL } from "../collection/session-state.js";
import { writeCollectionFile } from "../collection/storage.js";
import { CONSENT_VERSION } from "../collection/types.js";
import { cleanupTempDirs, tempDir } from "../test-support/index.js";

const emitUsageMock = vi.hoisted(() => vi.fn());

vi.mock("../collection/emit.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../collection/emit.js")>();
  return { ...mod, emitUsage: emitUsageMock };
});

afterAll(() => cleanupTempDirs());

describe("collection:metric CLI dimensions (#9)", () => {
  it("rejects invalid --dimensions JSON with exit 2", async () => {
    const { run } = await import("./collection-metric.js");
    const root = tempDir("canon-metric-badjson-");
    const code = await run([
      `--project-root=${root}`,
      "--metric=orient_ok",
      "--value=1",
      "--dimensions={not-json",
    ]);
    expect(code).toBe(2);
  });

  it("accepts --dimensions JSON when metrics are active (soft exit 0)", async () => {
    const { run } = await import("./collection-metric.js");
    const root = tempDir("canon-metric-dim-");
    emitUsageMock.mockResolvedValue({ emitted: false, reason: "submit_failed" });
    writeCollectionFile(root, {
      installId: "11111111-1111-4111-8111-111111111111",
      token: "tok",
      metrics: {
        decision: "active",
        scopes: ["usage"],
        consentVersion: CONSENT_VERSION,
        decidedAt: "2026-08-01T00:00:00.000Z",
        expiresAt: Date.now() + 86_400_000,
      },
    });
    const code = await run([
      `--project-root=${root}`,
      "--metric=kickoff_done",
      "--value=1",
      '--dimensions={"scopes_created":6,"stack_family":"node"}',
    ]);
    expect(code).toBe(0);
  });

  it("agent_turn records a local session counter without requiring network", async () => {
    const { run } = await import("./collection-metric.js");
    const root = tempDir("canon-metric-turn-");
    const code = await run([`--project-root=${root}`, "--metric=agent_turn", "--value=1"]);
    expect(code).toBe(0);
    expect(readSession(root)?.agentTurns).toBe(1);
  });

  it("session_summary clears session file after emit when consented", async () => {
    const { run } = await import("./collection-metric.js");
    const root = tempDir("canon-metric-summary-");
    emitUsageMock.mockResolvedValue({ emitted: true, id: "sum-1" });
    writeCollectionFile(root, {
      installId: "11111111-1111-4111-8111-111111111111",
      token: "tok",
      metrics: {
        decision: "active",
        scopes: ["usage"],
        consentVersion: CONSENT_VERSION,
        decidedAt: "2026-08-01T00:00:00.000Z",
        expiresAt: Date.now() + 86_400_000,
      },
    });
    await run([`--project-root=${root}`, "--metric=agent_turn", "--value=1"]);
    const code = await run([`--project-root=${root}`, "--metric=session_summary", "--value=1"]);
    expect(code).toBe(0);
    expect(existsSync(join(root, SESSION_FILE_REL))).toBe(false);
  });
});
