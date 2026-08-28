import type { Collector } from "@deft/collection-sdk";
import { afterAll, describe, expect, it } from "vitest";
import { cleanupTempDirs, tempDir } from "../test-support/index.js";
import { emitUsage } from "./emit.js";
import { writeCollectionFile } from "./storage.js";
import { CONSENT_VERSION } from "./types.js";

afterAll(() => cleanupTempDirs());

function stubCollector(submit: Collector["submit"]): Collector {
  return {
    ensureRegistered: async () => ({ ok: true, installId: "x", state: "active" }),
    optIn: async () => ({ ok: true, state: "active", scopes: ["usage"], expiresAt: 1 }),
    optOut: async () => ({ ok: true, state: "revoked" }),
    status: async () => ({ ok: true, state: "active", scopes: ["usage"] }),
    submit,
  };
}

describe("emitUsage", () => {
  it("no-ops when usage is not consented", async () => {
    const root = tempDir("canon-emit-");
    const outcome = await emitUsage(root, "orient_ok", 1);
    expect(outcome).toEqual({ emitted: false, reason: "no_consent" });
  });

  it("submits when usage is active and never throws on transport failure", async () => {
    const root = tempDir("canon-emit-ok-");
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

    const ok = await emitUsage(root, "scope_complete", 1, {
      collector: stubCollector(async () => ({ ok: true, id: "evt-1" })),
    });
    expect(ok).toEqual({ emitted: true, id: "evt-1" });

    const failed = await emitUsage(root, "scope_complete", 1, {
      collector: stubCollector(async () => ({
        ok: false,
        code: "transport_error",
        retryable: true,
      })),
    });
    expect(failed.emitted).toBe(false);
    if (failed.emitted === false) {
      expect(failed.reason).toBe("submit_failed");
    }
  });

  it("SUB-5a / #9: includes dimensions on the usage payload when consented", async () => {
    const root = tempDir("canon-emit-dim-");
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

    let captured: unknown;
    const ok = await emitUsage(root, "scope_complete", 1, {
      dimensions: {
        disposition: "accepted_not_delivered",
        kind: "story",
        had_delivery_pr: false,
        acceptance_total: 3,
      },
      collector: stubCollector(async (_scope, payload) => {
        captured = payload;
        return { ok: true, id: "evt-dim" };
      }),
    });
    expect(ok).toEqual({ emitted: true, id: "evt-dim" });
    expect(captured).toEqual({
      metric: "scope_complete",
      value: 1,
      dimensions: {
        disposition: "accepted_not_delivered",
        kind: "story",
        had_delivery_pr: false,
        acceptance_total: 3,
      },
    });
  });

  it("#9: rejects oversized dimensions without submitting", async () => {
    const root = tempDir("canon-emit-oversize-");
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
    let submitted = false;
    const big = { pad: "x".repeat(3000) };
    const outcome = await emitUsage(root, "orient_ok", 1, {
      dimensions: big,
      collector: stubCollector(async () => {
        submitted = true;
        return { ok: true, id: "nope" };
      }),
    });
    expect(submitted).toBe(false);
    expect(outcome).toEqual({ emitted: false, reason: "submit_failed", code: "dimensions_too_large" });
  });
});
