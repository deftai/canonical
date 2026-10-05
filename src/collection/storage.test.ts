/**
 * WP2 G1 [C]: STO-2, STO-3, STO-4 at the CLI / disk / fake-collector boundary.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  canon,
  cleanupTempDirs,
  installCollectionHarness,
  installCollectionTestHooks,
  readCollectionState,
} from "../test-support/index.js";

installCollectionTestHooks();
afterAll(() => cleanupTempDirs());

const CONSENT_VERSION = "canonical-2026-09-b";

function writeState(root: string, state: Record<string, unknown>): void {
  const dir = join(root, ".canonical");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "collection.json"), `${JSON.stringify(state, null, 2)}\n`);
}

function stateText(root: string): string {
  const path = join(root, ".canonical", "collection.json");
  if (!existsSync(path)) {
    return "";
  }
  return readFileSync(path, "utf8");
}

describe("STO storage (WP2)", () => {
  it("STO-2: no writes outside the project root; no correlator header or body field", async () => {
    const { root, home, fake } = installCollectionHarness();
    const result = await canon(["collection:opt-in", "--confirm"], { cwd: root });
    expect(result.code).toBe(0);

    expect(existsSync(join(home, ".config", "canonical"))).toBe(false);
    expect(existsSync(join(home, ".config", "canonical", "identity.json"))).toBe(false);

    expect(fake.requests.length).toBeGreaterThan(0);
    for (const req of fake.requests) {
      expect(req.headers["x-deft-correlator"]).toBeUndefined();
      if (req.body !== null && typeof req.body === "object" && !Array.isArray(req.body)) {
        expect(req.body).not.toHaveProperty("correlator");
      }
    }
  });

  it("STO-3: state file never holds name/email/mobile; lean shape after opt-in and opt-out", async () => {
    const { root } = installCollectionHarness();
    const opted = await canon(
      [
        "collection:opt-in",
        "--confirm",
        "--first-name=Ada",
        "--last-name=Lovelace",
        "--email=ada@example.com",
        "--mobile=+15551234567",
      ],
      { cwd: root },
    );
    expect(opted.code).toBe(0);

    const afterOptIn = readCollectionState(root);
    const raw = stateText(root);
    expect(raw).not.toMatch(/ada@example\.com/i);
    expect(raw).not.toMatch(/Lovelace/);
    expect(raw).not.toMatch(/\+15551234567/);
    expect(afterOptIn).not.toHaveProperty("identity");
    expect(afterOptIn).not.toHaveProperty("metricsMode");
    expect(afterOptIn.attributed).toBe(true);
    expect(afterOptIn.metrics).toMatchObject({
      decision: "active",
      consentVersion: CONSENT_VERSION,
    });
    expect(afterOptIn.metrics).not.toHaveProperty("scopes");
    if (afterOptIn.submissions !== undefined) {
      expect(afterOptIn.submissions).not.toHaveProperty("granted");
      expect(afterOptIn.submissions).not.toHaveProperty("scopes");
    }

    const out = await canon(["collection:opt-out", "--confirm"], { cwd: root });
    expect(out.code).toBe(0);
    const afterOut = readCollectionState(root);
    expect(Object.keys(afterOut).sort()).toEqual(["metrics"]);
    expect(afterOut.metrics).toMatchObject({ decision: "revoked" });
    expect(afterOut).not.toHaveProperty("submissions");
    expect(afterOut).not.toHaveProperty("attributed");
    expect(afterOut).not.toHaveProperty("installId");
    expect(afterOut).not.toHaveProperty("token");
    expect(afterOut).not.toHaveProperty("metricsMode");
  });

  it("STO-4: reading normalizes legacy shapes and rewrites the file once", async () => {
    const { root } = installCollectionHarness();

    // identity object → attributed: true; drop metricsMode / scopes / granted.
    writeState(root, {
      installId: "legacy-id",
      token: "legacy-tok",
      metrics: {
        decision: "active",
        scopes: ["usage"],
        consentVersion: CONSENT_VERSION,
        decidedAt: "2026-01-01T00:00:00.000Z",
        expiresAt: Date.now() + 86_400_000,
      },
      metricsMode: "attributed",
      identity: { firstName: "Ada", email: "ada@example.com" },
      submissions: {
        granted: true,
        scopes: ["bug", "feedback", "feature"],
        consentVersion: CONSENT_VERSION,
        decidedAt: "2026-01-01T00:00:00.000Z",
        expiresAt: Date.now() + 86_400_000,
      },
    });
    const status = await canon(["collection:status"], { cwd: root });
    expect(status.code).toBe(0);
    expect(status.out).toMatch(/identity=identified/);

    const normalized = readCollectionState(root);
    expect(normalized.attributed).toBe(true);
    expect(normalized).not.toHaveProperty("identity");
    expect(normalized).not.toHaveProperty("metricsMode");
    expect(normalized.metrics).not.toHaveProperty("scopes");
    expect(normalized.submissions).toBeDefined();
    expect(normalized.submissions).not.toHaveProperty("granted");
    expect(normalized.submissions).not.toHaveProperty("scopes");
    expect(stateText(root)).not.toMatch(/ada@example\.com/);

    // submissions.granted === false → no submissions key.
    writeState(root, {
      metrics: {
        decision: "declined",
        scopes: [],
        consentVersion: CONSENT_VERSION,
        decidedAt: "2026-01-01T00:00:00.000Z",
      },
      submissions: { granted: false },
      metricsMode: "disallowed",
    });
    await canon(["collection:status"], { cwd: root });
    expect(readCollectionState(root)).not.toHaveProperty("submissions");
    expect(readCollectionState(root)).not.toHaveProperty("metricsMode");

    // Partial submission scopes → not granted.
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
        scopes: ["bug"],
        consentVersion: CONSENT_VERSION,
        decidedAt: "2026-01-01T00:00:00.000Z",
        expiresAt: Date.now() + 86_400_000,
      },
    });
    const partial = await canon(["collection:status"], { cwd: root });
    expect(partial.out + partial.err).toMatch(/submissions=not_granted/);
    expect(readCollectionState(root)).not.toHaveProperty("submissions");

    // Legacy top-level consent mirror: active + all four scopes → metrics active + submissions.
    writeState(root, {
      consent: {
        decision: "active",
        scopes: ["usage", "feedback", "bug", "feature"],
        consentVersion: CONSENT_VERSION,
        decidedAt: "2026-01-01T00:00:00.000Z",
        expiresAt: Date.now() + 86_400_000,
      },
    });
    const legacy = await canon(["collection:status"], { cwd: root });
    expect(legacy.code).toBe(0);
    expect(legacy.out).toMatch(/metrics=active/);
    expect(legacy.out).toMatch(/submissions=granted/);
    const afterLegacy = readCollectionState(root);
    expect(afterLegacy).not.toHaveProperty("consent");
    expect(afterLegacy.metrics).toMatchObject({ decision: "active" });
    expect(afterLegacy.submissions).toBeDefined();
  });
});
