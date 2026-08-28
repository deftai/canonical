import { afterAll, describe, expect, it } from "vitest";
import { writeCollectionFile } from "../collection/storage.js";
import { CONSENT_VERSION } from "../collection/types.js";
import { cleanupTempDirs, tempDir } from "../test-support/index.js";
import { run } from "./collection-metric.js";

afterAll(() => cleanupTempDirs());

describe("collection:metric CLI dimensions (#9)", () => {
  it("rejects invalid --dimensions JSON with exit 2", async () => {
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
    const root = tempDir("canon-metric-dim-");
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
    // No network — emit will soft-fail submit without credentials against real endpoint,
    // but arg parsing must succeed (exit 0 soft-fail path).
    const code = await run([
      `--project-root=${root}`,
      "--metric=kickoff_done",
      "--value=1",
      '--dimensions={"scopes_created":6,"stack_family":"node"}',
    ]);
    expect(code).toBe(0);
  });
});
