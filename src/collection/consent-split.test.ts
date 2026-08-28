import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Collector } from "@deft/collection-sdk";
import { afterAll, describe, expect, it } from "vitest";
import { cleanupTempDirs, tempDir } from "../test-support/index.js";
import { createCanonicalCollector } from "./client.js";
import {
  collectionDecline,
  collectionOptIn,
  collectionStatus,
  resolveConsentSignal,
} from "./consent.js";
import { emitUsage } from "./emit.js";
import { submitFeedback } from "./feedback.js";
import { readCollectionFile } from "./storage.js";
import {
  COLLECTION_FILE_REL,
  CONSENT_VERSION,
  DEFAULT_SCOPES,
  METRICS_SCOPES,
  SUBMISSION_SCOPES,
} from "./types.js";

afterAll(() => cleanupTempDirs());

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function mockFetchForScopes(optInScopes: readonly string[]): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "POST" && url.endsWith("/v1/registrations")) {
      return jsonResponse(200, {
        install_id: "11111111-1111-4111-8111-111111111111",
        install_token: "tok-test",
        state: "pending",
      });
    }
    if (method === "POST" && url.includes("/optin")) {
      let requested: string[] = [...optInScopes];
      if (typeof init?.body === "string") {
        const body = JSON.parse(init.body) as { scopes?: string[] };
        if (Array.isArray(body.scopes)) {
          requested = body.scopes;
        }
      }
      return jsonResponse(200, {
        state: "active",
        scopes: requested,
        expires_at: Date.now() + 86_400_000,
      });
    }
    if (method === "POST" && url.includes("/v1/submissions/")) {
      return jsonResponse(200, { id: "sub-1" });
    }
    return jsonResponse(404, { error: "not_found" });
  }) as typeof fetch;
}

function stubCollector(overrides: Partial<Collector> = {}): Collector {
  return {
    ensureRegistered: async () => ({ ok: true, installId: "x", state: "active" }),
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

describe("C4 consent split", () => {
  it("DEFAULT_SCOPES is usage only (metrics opt-in)", () => {
    expect([...DEFAULT_SCOPES]).toEqual(["usage"]);
    expect([...METRICS_SCOPES]).toEqual(["usage"]);
    expect([...SUBMISSION_SCOPES]).toEqual(["feedback", "bug", "feature"]);
    expect(CONSENT_VERSION).toBe("canonical-2026-09-a");
  });

  it("collection:opt-in --confirm defaults to usage only", async () => {
    const root = tempDir("canon-c4-optin-");
    const configDir = tempDir("canon-c4-optin-cfg-");
    const fetchImpl = mockFetchForScopes(["usage"]);
    const collector = createCanonicalCollector(root, {
      configDir,
      fetch: fetchImpl,
      autoRegister: false,
    });
    const ok = await collectionOptIn(root, { confirm: true, configDir, collector });
    expect(ok.code).toBe(0);
    expect(ok.scopes).toEqual(["usage"]);

    const file = readCollectionFile(root);
    const signal = resolveConsentSignal(file);
    expect(signal.metrics).toBe("active");
    expect(signal.submissions).toBe("not_granted");
    expect(signal.identity).toBe("anonymous");
  });

  it("feedback requires disclosure when metrics declined and submissions not granted", async () => {
    const root = tempDir("canon-c4-disc-");
    collectionDecline(root, { now: new Date("2026-08-01T00:00:00.000Z") });

    const result = await submitFeedback(root, {
      kind: "feedback",
      message: "hello",
      collector: stubCollector(),
    });
    expect(result.code).toBe(1);
    expect(result.disclosureRequired).toBe(true);
    expect(result.message.toLowerCase()).toMatch(/disclosure/);

    const signal = resolveConsentSignal(readCollectionFile(root));
    expect(signal.metrics).toBe("declined");
    expect(signal.submissions).toBe("not_granted");
  });

  it("disclosure-accepted grants submissions only; metrics stay declined; submit proceeds", async () => {
    const root = tempDir("canon-c4-grant-");
    collectionDecline(root, { now: new Date("2026-08-01T00:00:00.000Z") });

    let optedScopes: string[] | undefined;
    let submitted: { scope: string; payload: unknown } | undefined;
    const collector = stubCollector({
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
        return { ok: true, id: "sub-disc-1" };
      },
    });

    const result = await submitFeedback(root, {
      kind: "bug",
      summary: "crash",
      disclosureAccepted: true,
      collector,
      version: "0.3.0",
    });
    expect(result.code).toBe(0);
    expect(result.id).toBe("sub-disc-1");
    expect(optedScopes).toEqual(["feedback", "bug", "feature"]);
    expect(optedScopes).not.toContain("usage");
    expect(submitted?.scope).toBe("bug");

    const file = readCollectionFile(root);
    const signal = resolveConsentSignal(file);
    expect(signal.metrics).toBe("declined");
    expect(signal.submissions).toBe("granted");
    expect(signal.identity).toBe("anonymous");
  });

  it("soft-skips usage metrics when metrics declined even after submissions granted", async () => {
    const root = tempDir("canon-c4-soft-");
    collectionDecline(root, { now: new Date("2026-08-01T00:00:00.000Z") });

    await submitFeedback(root, {
      kind: "feature",
      summary: "dark mode",
      disclosureAccepted: true,
      collector: stubCollector(),
    });

    const signal = resolveConsentSignal(readCollectionFile(root));
    expect(signal.metrics).toBe("declined");
    expect(signal.submissions).toBe("granted");

    let submitCalled = false;
    const outcome = await emitUsage(root, "orient_ok", 1, {
      collector: stubCollector({
        submit: async () => {
          submitCalled = true;
          return { ok: true, id: "should-not" };
        },
      }),
    });
    expect(outcome).toEqual({ emitted: false, reason: "no_consent" });
    expect(submitCalled).toBe(false);
  });

  it("migrates legacy all-scopes active file without re-prompt", () => {
    const root = tempDir("canon-c4-mig-");
    const legacyPath = join(root, COLLECTION_FILE_REL);
    mkdirSync(join(root, ".canonical"), { recursive: true });
    writeFileSync(
      legacyPath,
      `${JSON.stringify(
        {
          installId: "legacy-id",
          token: "legacy-tok",
          consent: {
            decision: "active",
            scopes: ["feedback", "bug", "feature", "usage"],
            consentVersion: "canonical-2026-08-a",
            decidedAt: "2026-08-01T00:00:00.000Z",
            expiresAt: Date.now() + 86_400_000,
          },
        },
        null,
        2,
      )}\n`,
    );

    const file = readCollectionFile(root);
    const signal = resolveConsentSignal(file);
    expect(signal.metrics).toBe("active");
    expect(signal.submissions).toBe("granted");
    expect(signal.identity).toBe("anonymous");
    expect(hasUsageAfterMigrate(file)).toBe(true);
    expect(file.consent).toBeUndefined();
    expect(file.metrics?.scopes).toEqual(["usage"]);
    expect(file.submissions?.granted).toBe(true);
  });

  it("status message is machine-parseable metrics/submissions/identity", async () => {
    const root = tempDir("canon-c4-status-");
    const result = await collectionStatus(root);
    expect(result.message).toMatch(
      /metrics=not_prompted submissions=not_granted identity=anonymous/,
    );
    expect(result.status.metrics).toBe("not_prompted");
    expect(result.status.submissions).toBe("not_granted");
    expect(result.status.identity).toBe("anonymous");
  });
});

function hasUsageAfterMigrate(file: ReturnType<typeof readCollectionFile>): boolean {
  return resolveConsentSignal(file).metrics === "active";
}
