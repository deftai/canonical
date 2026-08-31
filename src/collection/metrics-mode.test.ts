import type { Collector } from "@deft/collection-sdk";
import { afterAll, describe, expect, it } from "vitest";
import { cleanupTempDirs, tempDir } from "../test-support/index.js";
import {
  collectionDecline,
  collectionOptIn,
  collectionOptOut,
  collectionStatus,
  ensureAttributedOptIn,
  resolveConsentSignal,
} from "./consent.js";
import { collectionIdentityUpdate } from "./contact-identity.js";
import { submitFeedback } from "./feedback.js";
import { formatConsentSignal, readCollectionFile, writeCollectionFile } from "./storage.js";
import { CONSENT_VERSION, METRICS_SCOPES, type MetricsMode, SUBMISSION_SCOPES } from "./types.js";

afterAll(() => cleanupTempDirs());

function stubCollector(projectRoot: string, overrides: Partial<Collector> = {}): Collector {
  return {
    ensureRegistered: async () => {
      const installId = "11111111-1111-4111-8111-111111111111";
      writeCollectionFile(projectRoot, {
        ...readCollectionFile(projectRoot),
        installId,
        token: "tok-test",
      });
      return { ok: true, installId, state: "active" };
    },
    optIn: async (args) => ({
      ok: true,
      state: "active",
      scopes: args.scopes,
      expiresAt: Date.now() + 86_400_000,
    }),
    optOut: async () => ({ ok: true, state: "revoked" }),
    status: async () => ({ ok: true, state: "active", scopes: ["usage"] }),
    submit: async () => ({ ok: true, id: "sub-1" }),
    ...overrides,
  };
}

describe("P1 metricsMode tri-state", () => {
  it("persists metricsMode=disallowed on collection:decline", () => {
    const root = tempDir("canon-mm-decline-");
    expect(collectionDecline(root).code).toBe(0);
    const file = readCollectionFile(root);
    expect(file.metricsMode).toBe("disallowed");
    expect(file.metrics?.decision).toBe("declined");
    const signal = resolveConsentSignal(file);
    expect(signal.metricsMode).toBe("disallowed");
    expect(formatConsentSignal(file)).toMatch(/metricsMode=disallowed/);
  });

  it("collection:opt-in --confirm persists metricsMode=anonymous", async () => {
    const root = tempDir("canon-mm-anon-");
    const ok = await collectionOptIn(root, { confirm: true, collector: stubCollector(root) });
    expect(ok.code).toBe(0);
    const file = readCollectionFile(root);
    expect(file.metricsMode).toBe("anonymous");
    expect(file.metrics?.decision).toBe("active");
    expect(file.metrics?.scopes).toEqual(["usage"]);
    const signal = resolveConsentSignal(file);
    expect(signal.metricsMode).toBe("anonymous");
    expect(signal.identity).toBe("anonymous");
    expect(signal.identityMode).toBe("anonymous");
    expect(formatConsentSignal(file)).toMatch(/metricsMode=anonymous .* identity=anonymous/);
  });

  it("opt-in + identity update persists metricsMode=attributed and syncs contact", async () => {
    const root = tempDir("canon-mm-attr-");
    let seenContact: unknown;
    const collector = stubCollector(root, {
      optIn: async (args) => {
        if (args.contact !== undefined) {
          seenContact = args.contact;
        }
        return {
          ok: true,
          state: "active",
          scopes: args.scopes,
          expiresAt: Date.now() + 86_400_000,
        };
      },
    });

    expect((await collectionOptIn(root, { confirm: true, collector })).code).toBe(0);
    const updated = await collectionIdentityUpdate(
      root,
      { firstName: "Ada", email: "ada@example.com" },
      { collector },
    );
    expect(updated.code).toBe(0);
    expect(updated.mode).toBe("identified");

    const file = readCollectionFile(root);
    expect(file.metricsMode).toBe("attributed");
    expect(file.identity?.email).toBe("ada@example.com");
    expect(seenContact).toMatchObject({ email: "ada@example.com", name: "Ada" });
    expect(resolveConsentSignal(file).metricsMode).toBe("attributed");
    expect(formatConsentSignal(file)).toMatch(/metricsMode=attributed .* identity=identified/);
  });

  it("ensureAttributedOptIn stores identity, sets attributed, and syncs contact", async () => {
    const root = tempDir("canon-mm-ensure-");
    let seenContact: unknown;
    const collector = stubCollector(root, {
      optIn: async (args) => {
        if (args.contact !== undefined) {
          seenContact = args.contact;
        }
        return {
          ok: true,
          state: "active",
          scopes: args.scopes.includes("usage") ? args.scopes : ["usage", ...args.scopes],
          expiresAt: Date.now() + 86_400_000,
        };
      },
    });

    const result = await ensureAttributedOptIn(
      root,
      { email: "ada@example.com", mobile: "+15551234567" },
      { confirm: true, collector },
    );
    expect(result.code).toBe(0);
    expect(result.metricsMode).toBe("attributed");
    expect(result.identityMode).toBe("identified");

    const file = readCollectionFile(root);
    expect(file.metricsMode).toBe("attributed");
    expect(file.identity?.email).toBe("ada@example.com");
    expect(seenContact).toMatchObject({
      email: "ada@example.com",
      sms: "+15551234567",
    });
  });

  it("status exposes metricsMode for agents", async () => {
    const root = tempDir("canon-mm-status-");
    await collectionOptIn(root, { confirm: true, collector: stubCollector(root) });
    const status = await collectionStatus(root);
    expect(status.status.metricsMode).toBe("anonymous");
    expect(status.message).toMatch(/metricsMode=anonymous/);
    expect(status.status.identityMode).toBe("anonymous");
  });

  it("undecided when never prompted", () => {
    const mode: MetricsMode = resolveConsentSignal({}).metricsMode;
    expect(mode).toBe("undecided");
    expect(formatConsentSignal({})).toMatch(/metricsMode=undecided/);
  });
});

describe("P2 feedback without durable disclosure ceremony", () => {
  it("submit works when metricsMode=disallowed with --disclosure-accepted confirm", async () => {
    const root = tempDir("canon-mm-fb-disallowed-");
    collectionDecline(root);
    expect(readCollectionFile(root).metricsMode).toBe("disallowed");

    let optedScopes: string[] | undefined;
    let submitted: { scope: string; payload: unknown } | undefined;
    const collector = stubCollector(root, {
      optIn: async (args) => {
        optedScopes = args.scopes;
        return {
          ok: true,
          state: "active",
          scopes: args.scopes,
          expiresAt: Date.now() + 86_400_000,
        };
      },
      submit: async (scope, payload) => {
        submitted = { scope, payload };
        return { ok: true, id: "sub-disallowed-1" };
      },
    });

    const result = await submitFeedback(root, {
      kind: "feedback",
      message: "still useful",
      disclosureAccepted: true,
      collector,
    });
    expect(result.code).toBe(0);
    expect(result.id).toBe("sub-disallowed-1");
    expect(optedScopes).toEqual(["feedback", "bug", "feature"]);
    expect(optedScopes).not.toContain("usage");
    expect(submitted?.scope).toBe("feedback");
    expect(readCollectionFile(root).metricsMode).toBe("disallowed");
    expect(resolveConsentSignal(readCollectionFile(root)).metrics).toBe("declined");
  });

  it("without confirm flag, asks for user confirm (not a separate grant ceremony)", async () => {
    const root = tempDir("canon-mm-fb-confirm-");
    collectionDecline(root);
    const result = await submitFeedback(root, {
      kind: "bug",
      summary: "crash",
      collector: stubCollector(root),
    });
    expect(result.code).toBe(1);
    expect(result.disclosureRequired).toBe(true);
    expect(result.message.toLowerCase()).toMatch(/confirm|disclosure-accepted/);
    expect(result.message.toLowerCase()).not.toMatch(/ceremony/);
  });

  it("exposes identityMode for association (pack-side); payloads stay PRIV-2 clean", async () => {
    const root = tempDir("canon-mm-fb-ident-");
    writeCollectionFile(root, {
      installId: "id",
      token: "tok",
      metricsMode: "attributed",
      metrics: {
        decision: "active",
        scopes: [...METRICS_SCOPES],
        consentVersion: CONSENT_VERSION,
        decidedAt: "2026-08-01T00:00:00.000Z",
        expiresAt: Date.now() + 86_400_000,
      },
      submissions: {
        granted: true,
        scopes: [...SUBMISSION_SCOPES],
        consentVersion: CONSENT_VERSION,
        decidedAt: "2026-08-01T00:00:00.000Z",
        expiresAt: Date.now() + 86_400_000,
      },
      identity: { email: "ada@example.com" },
    });

    const signal = resolveConsentSignal(readCollectionFile(root));
    expect(signal.identityMode).toBe("identified");
    expect(signal.metricsMode).toBe("attributed");

    let payload: Record<string, unknown> | undefined;
    const result = await submitFeedback(root, {
      kind: "bug",
      summary: "crash",
      collector: stubCollector(root, {
        submit: async (_scope, p) => {
          payload = p as Record<string, unknown>;
          return { ok: true, id: "sub-2" };
        },
      }),
    });
    expect(result.code).toBe(0);
    expect(payload).toBeDefined();
    expect(payload).not.toHaveProperty("email");
    expect(payload).not.toHaveProperty("contact");
    expect(JSON.stringify(payload)).not.toContain("ada@example.com");
  });
});

describe("P3 opt-out rotates install", () => {
  it("opt-out clears identity, sets metricsMode disallowed, clears installId/token", async () => {
    const root = tempDir("canon-mm-optout-");
    const collector = stubCollector(root);
    await collectionOptIn(root, { confirm: true, collector });
    await collectionIdentityUpdate(root, { email: "ada@example.com" }, { collector });
    expect(readCollectionFile(root).installId).toBeDefined();
    expect(readCollectionFile(root).metricsMode).toBe("attributed");

    let optOutCalled = false;
    const outCollector = stubCollector(root, {
      optOut: async () => {
        optOutCalled = true;
        return { ok: true, state: "revoked" };
      },
    });
    const out = await collectionOptOut(root, { confirm: true, collector: outCollector });
    expect(out.code).toBe(0);
    expect(optOutCalled).toBe(true);

    const file = readCollectionFile(root);
    expect(file.installId).toBeUndefined();
    expect(file.token).toBeUndefined();
    expect(file.identity).toBeUndefined();
    expect(file.metricsMode).toBe("disallowed");
    expect(file.metrics?.decision).toBe("revoked");
    expect(file.submissions?.granted).toBe(false);
    expect(resolveConsentSignal(file).metricsMode).toBe("disallowed");
  });

  it("next register after opt-out receives a new installId", async () => {
    const root = tempDir("canon-mm-rotate-");
    let registration = 0;
    const collector = stubCollector(root, {
      ensureRegistered: async () => {
        registration += 1;
        const installId =
          registration === 1
            ? "11111111-1111-4111-8111-111111111111"
            : "22222222-2222-4222-8222-222222222222";
        // Simulate SDK writing credentials via project storage on register.
        writeCollectionFile(root, {
          ...readCollectionFile(root),
          installId,
          token: `tok-${registration}`,
        });
        return { ok: true, installId, state: "pending" };
      },
    });

    expect((await collectionOptIn(root, { confirm: true, collector })).code).toBe(0);
    const firstId = readCollectionFile(root).installId;
    expect(firstId).toBe("11111111-1111-4111-8111-111111111111");

    expect((await collectionOptOut(root, { confirm: true, collector })).code).toBe(0);
    expect(readCollectionFile(root).installId).toBeUndefined();

    expect((await collectionOptIn(root, { confirm: true, collector })).code).toBe(0);
    const secondId = readCollectionFile(root).installId;
    expect(secondId).toBe("22222222-2222-4222-8222-222222222222");
    expect(secondId).not.toBe(firstId);
  });
});
