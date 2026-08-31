import type { Collector } from "@deft/collection-sdk";
import { afterAll, describe, expect, it } from "vitest";
import { cleanupTempDirs, tempDir } from "../test-support/index.js";
import { submitFeedback } from "./feedback.js";
import { writeCollectionFile } from "./storage.js";
import { CONSENT_VERSION, SUBMISSION_SCOPES } from "./types.js";

afterAll(() => cleanupTempDirs());

function stubCollector(submitImpl: Collector["submit"]): Collector {
  return {
    ensureRegistered: async () => ({ ok: true, installId: "x", state: "active" }),
    optIn: async () => ({
      ok: true,
      state: "active",
      scopes: [...SUBMISSION_SCOPES],
      expiresAt: 1,
    }),
    optOut: async () => ({ ok: true, state: "revoked" }),
    status: async () => ({ ok: true, state: "active", scopes: [...SUBMISSION_SCOPES] }),
    submit: submitImpl,
  };
}

describe("submitFeedback", () => {
  it("rejects missing summary/message with exit 2", async () => {
    const root = tempDir("canon-fb-");
    const result = await submitFeedback(root, { kind: "bug" });
    expect(result.code).toBe(2);
  });

  it("fails closed with user-confirm required when submissions not granted", async () => {
    const root = tempDir("canon-fb-noconsent-");
    const result = await submitFeedback(root, {
      kind: "feature",
      summary: "add dark mode",
    });
    expect(result.code).toBe(1);
    expect(result.disclosureRequired).toBe(true);
    expect(result.message.toLowerCase()).toMatch(/confirm|disclosure-accepted/);
  });

  it("submits bug payload when submissions granted", async () => {
    const root = tempDir("canon-fb-ok-");
    writeCollectionFile(root, {
      installId: "id",
      token: "tok",
      submissions: {
        granted: true,
        scopes: [...SUBMISSION_SCOPES],
        consentVersion: CONSENT_VERSION,
        decidedAt: "2026-08-01T00:00:00.000Z",
        expiresAt: Date.now() + 86_400_000,
      },
    });

    let seen: { scope: string; payload: unknown } | undefined;
    const collector = stubCollector(async (scope, payload) => {
      seen = { scope, payload };
      return { ok: true, id: "sub-1" };
    });

    const result = await submitFeedback(root, {
      kind: "bug",
      summary: "crash on orient",
      collector,
    });
    expect(result.code).toBe(0);
    expect(result.id).toBe("sub-1");
    expect(seen?.scope).toBe("bug");
    expect(seen?.payload).toMatchObject({ summary: "crash on orient" });
  });
});
