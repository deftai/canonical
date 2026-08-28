import { chmodSync, existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cleanupTempDirs, tempDir } from "../test-support/index.js";
import {
  hasScopeConsent,
  hasUsageConsent,
  localPromptState,
  projectCredentialStorage,
  readCollectionFile,
  writeCollectionFile,
  writeMetricsMirror,
} from "./storage.js";
import { CONSENT_VERSION } from "./types.js";

afterAll(() => cleanupTempDirs());

describe("collection storage", () => {
  it("round-trips credentials via CredentialStorage without dropping consent", async () => {
    const root = tempDir("canon-coll-");
    writeMetricsMirror(root, {
      decision: "active",
      scopes: ["usage"],
      consentVersion: CONSENT_VERSION,
      decidedAt: "2026-08-01T00:00:00.000Z",
      expiresAt: Date.now() + 86_400_000,
    });

    const storage = projectCredentialStorage(root);
    expect(await storage.load()).toBeNull();

    await storage.save({ installId: "install-1", token: "token-1" });
    expect(await storage.load()).toEqual({ installId: "install-1", token: "token-1" });

    const file = readCollectionFile(root);
    expect(file.metrics?.decision).toBe("active");
    expect(file.installId).toBe("install-1");

    await storage.clear();
    const after = readCollectionFile(root);
    expect(after.installId).toBeUndefined();
    expect(after.token).toBeUndefined();
    expect(after.metrics?.decision).toBe("active");
  });

  it("writes collection file with mode 0600 when platform supports it", () => {
    const root = tempDir("canon-coll-mode-");
    writeCollectionFile(root, { installId: "a", token: "b" });
    const path = join(root, ".canonical", "collection.json");
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, "utf8")).toContain("installId");
    try {
      chmodSync(path, 0o600);
      expect(statSync(path).mode & 0o777).toBe(0o600);
    } catch {
      // ignore platforms that don't honor mode
    }
  });

  it("derives prompt state and usage consent from the metrics mirror", () => {
    const now = 1_700_000_000_000;
    expect(localPromptState({})).toBe("not_prompted");
    expect(
      localPromptState({
        metrics: {
          decision: "declined",
          scopes: [],
          consentVersion: CONSENT_VERSION,
          decidedAt: "2026-01-01T00:00:00.000Z",
        },
      }),
    ).toBe("declined");
    expect(
      localPromptState(
        {
          metrics: {
            decision: "active",
            scopes: ["usage"],
            consentVersion: CONSENT_VERSION,
            decidedAt: "2026-01-01T00:00:00.000Z",
            expiresAt: now - 1,
          },
        },
        now,
      ),
    ).toBe("expired");

    const active = {
      metrics: {
        decision: "active" as const,
        scopes: ["usage"],
        consentVersion: CONSENT_VERSION,
        decidedAt: "2026-01-01T00:00:00.000Z",
        expiresAt: now + 10_000,
      },
      submissions: {
        granted: true,
        scopes: ["bug", "feedback"],
      },
    };
    expect(hasUsageConsent(active, now)).toBe(true);
    expect(hasScopeConsent(active, "bug", now)).toBe(true);
    expect(hasScopeConsent(active, "feature", now)).toBe(false);
  });
});
