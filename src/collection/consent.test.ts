/**
 * WP2 G1 [C]: CON-4, CON-5, CON-6; SIG-3, SIG-5 at the CLI / disk / fake-collector boundary.
 */
import { mkdirSync, writeFileSync } from "node:fs";
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

describe("CON consent + SIG (WP2)", () => {
  it("CON-4: opt-in sends usage (+ submissions when granted); --scopes/--consent-version/--name unknown", async () => {
    const { root, fake } = installCollectionHarness();

    for (const flag of ["--scopes=usage", "--consent-version=other", "--name=Ada"]) {
      const bad = await canon(["collection:opt-in", "--confirm", flag], { cwd: root });
      expect(bad.code, flag).toBe(2);
      expect(bad.err, flag).toMatch(/unknown flag/);
      expect(fake.requests).toEqual([]);
    }

    writeState(root, {
      submissions: {
        granted: true,
        scopes: ["bug", "feedback", "feature"],
        consentVersion: CONSENT_VERSION,
        decidedAt: "2026-01-01T00:00:00.000Z",
        expiresAt: Date.now() + 86_400_000,
      },
    });
    const ok = await canon(["collection:opt-in", "--confirm"], { cwd: root });
    expect(ok.code).toBe(0);
    const optins = fake.requests.filter((r) => r.path.includes("/optin"));
    expect(optins).toHaveLength(1);
    const body = optins[0]?.body as {
      scopes: string[];
      consent_version?: string;
      consentVersion?: string;
    };
    expect([...body.scopes].sort()).toEqual(["bug", "feature", "feedback", "usage"].sort());
    const version = body.consent_version ?? body.consentVersion;
    expect(version).toBe(CONSENT_VERSION);
  });

  it("CON-5: anonymous opt-in sends contact:{} and stores attributed:false even when contact was on file", async () => {
    const { root, fake } = installCollectionHarness();

    const first = await canon(
      ["collection:opt-in", "--confirm", "--email=ada@example.com", "--first-name=Ada"],
      { cwd: root },
    );
    expect(first.code).toBe(0);

    fake.requests.length = 0;
    const anon = await canon(["collection:opt-in", "--confirm"], { cwd: root });
    expect(anon.code).toBe(0);
    const optins = fake.requests.filter((r) => r.path.includes("/optin"));
    expect(optins).toHaveLength(1);
    const body = optins[0]?.body as { contact?: unknown };
    expect(body).toHaveProperty("contact");
    expect(body.contact).toEqual({});
    const state = readCollectionState(root);
    expect(state.attributed).toBe(false);
    expect(state).not.toHaveProperty("identity");
  });

  it("CON-6: attributed opt-in with any non-empty contact (name alone ok) sends mapped contact once", async () => {
    const { root, fake } = installCollectionHarness();

    const nameOnly = await canon(
      ["collection:opt-in", "--confirm", "--first-name=Ada", "--last-name=Lovelace"],
      { cwd: root },
    );
    expect(nameOnly.code).toBe(0);
    expect(nameOnly.out).toMatch(/metricsMode=attributed/);
    let optins = fake.requests.filter((r) => r.path.includes("/optin"));
    expect(optins).toHaveLength(1);
    let body = optins[0]?.body as { contact: Record<string, string> };
    expect(body.contact).toEqual({ name: "Ada Lovelace" });
    expect(readCollectionState(root).attributed).toBe(true);

    await canon(["collection:opt-out", "--confirm"], { cwd: root });
    fake.requests.length = 0;

    const full = await canon(
      [
        "collection:opt-in",
        "--confirm",
        "--first-name=Ada",
        "--email=ada@example.com",
        "--mobile=+15551234567",
      ],
      { cwd: root },
    );
    expect(full.code).toBe(0);
    optins = fake.requests.filter((r) => r.path.includes("/optin"));
    expect(optins).toHaveLength(1);
    body = optins[0]?.body as { contact: Record<string, string> };
    expect(body.contact).toEqual({
      name: "Ada",
      email: "ada@example.com",
      sms: "+15551234567",
    });
    expect(Object.keys(body.contact).sort()).toEqual(["email", "name", "sms"]);
    expect(readCollectionState(root).attributed).toBe(true);
  });

  it("SIG-3: identity is identified iff attributed === true", async () => {
    const { root } = installCollectionHarness();

    writeState(root, {
      metrics: {
        decision: "active",
        consentVersion: CONSENT_VERSION,
        decidedAt: "2026-01-01T00:00:00.000Z",
        expiresAt: Date.now() + 86_400_000,
      },
      attributed: true,
    });
    let r = await canon(["collection:status"], { cwd: root });
    expect(r.out).toMatch(/identity=identified/);
    expect(r.out).toMatch(/metricsMode=attributed/);

    writeState(root, {
      metrics: {
        decision: "active",
        consentVersion: CONSENT_VERSION,
        decidedAt: "2026-01-01T00:00:00.000Z",
        expiresAt: Date.now() + 86_400_000,
      },
      attributed: false,
    });
    r = await canon(["collection:status"], { cwd: root });
    expect(r.out + r.err).toMatch(/identity=anonymous/);
    expect(r.out + r.err).toMatch(/metricsMode=anonymous/);

    // Legacy identity object alone must not leave identified after normalize without attributed.
    writeState(root, {
      metrics: {
        decision: "active",
        consentVersion: CONSENT_VERSION,
        decidedAt: "2026-01-01T00:00:00.000Z",
        expiresAt: Date.now() + 86_400_000,
      },
      identity: { email: "ada@example.com" },
    });
    r = await canon(["collection:status"], { cwd: root });
    // STO-4 sets attributed from identity, then SIG-3 reads attributed.
    expect(r.out).toMatch(/identity=identified/);
    expect(readCollectionState(root).attributed).toBe(true);
    expect(readCollectionState(root)).not.toHaveProperty("identity");
  });

  it("SIG-5: collection:status never networks; --live is unknown; live_state absent from JSON", async () => {
    const { root, fake } = installCollectionHarness();
    await canon(["collection:opt-in", "--confirm"], { cwd: root });
    fake.requests.length = 0;

    const status = await canon(["collection:status", "--json"], { cwd: root });
    expect(status.code).toBe(0);
    expect(fake.requests).toEqual([]);
    const body = JSON.parse(status.out) as Record<string, unknown>;
    expect(body).not.toHaveProperty("live_state");

    const live = await canon(["collection:status", "--live"], { cwd: root });
    expect(live.code).toBe(2);
    expect(live.err).toMatch(/unknown flag/);
    expect(fake.requests).toEqual([]);
  });
});
