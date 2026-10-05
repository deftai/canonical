/**
 * WP2 G1 [C]: FB-6 — disclosure message lists what will be sent without mentioning a correlator.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  canon,
  cleanupTempDirs,
  installCollectionHarness,
  installCollectionTestHooks,
} from "../test-support/index.js";

installCollectionTestHooks();
afterAll(() => cleanupTempDirs());

const CONSENT_VERSION = "canonical-2026-09-b";

function writeState(root: string, state: Record<string, unknown>): void {
  const dir = join(root, ".canonical");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "collection.json"), `${JSON.stringify(state, null, 2)}\n`);
}

describe("FB feedback (WP2)", () => {
  it("FB-6: disclosure message lists what will be sent without mentioning a correlator", async () => {
    const { root, fake } = installCollectionHarness();
    writeState(root, {
      metrics: {
        decision: "active",
        scopes: ["usage"],
        consentVersion: CONSENT_VERSION,
        decidedAt: "2026-01-01T00:00:00.000Z",
        expiresAt: Date.now() + 86_400_000,
      },
      submissions: {
        granted: true,
        scopes: ["bug", "feedback", "feature"],
        consentVersion: CONSENT_VERSION,
        decidedAt: "2026-01-01T00:00:00.000Z",
        expiresAt: Date.now() + 86_400_000,
      },
    });

    const result = await canon(["feedback", "--kind=feedback", "--message=hi", "--json"], {
      cwd: root,
    });
    expect(result.code).toBe(1);
    const body = JSON.parse(result.out) as { message: string; disclosure_required: boolean };
    expect(body.disclosure_required).toBe(true);
    expect(body.message).toMatch(/^feedback: user confirm required/);
    expect(body.message.toLowerCase()).not.toContain("correlator");
    expect(body.message.toLowerCase()).not.toContain("ceremony");
    // Still describes what will be sent.
    expect(body.message.toLowerCase()).toMatch(/will send/);
    expect(fake.requests).toEqual([]);
  });
});
