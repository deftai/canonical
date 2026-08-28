import { afterAll, describe, expect, it } from "vitest";
import { cleanupTempDirs, tempDir } from "../test-support/index.js";
import { createCanonicalCollector } from "./client.js";
import {
  collectionDecline,
  collectionOptIn,
  collectionOptOut,
  collectionStatus,
} from "./consent.js";
import { readCollectionFile } from "./storage.js";
import { CONSENT_VERSION } from "./types.js";

afterAll(() => cleanupTempDirs());

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function mockCollectorFetch(): typeof fetch {
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
      let scopes = ["usage"];
      if (typeof init?.body === "string") {
        const body = JSON.parse(init.body) as { scopes?: string[] };
        if (Array.isArray(body.scopes)) {
          scopes = body.scopes;
        }
      }
      return jsonResponse(200, {
        state: "active",
        scopes,
        expires_at: Date.now() + 86_400_000,
      });
    }
    if (method === "POST" && url.includes("/optout")) {
      return jsonResponse(200, { state: "revoked" });
    }
    if (method === "GET" && url.includes("/status")) {
      return jsonResponse(200, {
        state: "active",
        scopes: ["usage"],
        expires_at: Date.now() + 86_400_000,
        consent_version: CONSENT_VERSION,
      });
    }
    return jsonResponse(404, { error: "not_found" });
  }) as typeof fetch;
}

describe("collection consent flows", () => {
  it("reports not_prompted with exit 1 before any decision", async () => {
    const root = tempDir("canon-consent-");
    const result = await collectionStatus(root);
    expect(result.code).toBe(1);
    expect(result.status.promptState).toBe("not_prompted");
    expect(result.status.metrics).toBe("not_prompted");
    expect(result.status.submissions).toBe("not_granted");
    expect(result.message).toContain("metrics=not_prompted");
  });

  it("decline writes local metrics mirror without network", () => {
    const root = tempDir("canon-decline-");
    const result = collectionDecline(root, { now: new Date("2026-08-01T00:00:00.000Z") });
    expect(result.code).toBe(0);
    const file = readCollectionFile(root);
    expect(file.metrics?.decision).toBe("declined");
    expect(file.installId).toBeUndefined();
  });

  it("opt-in requires --confirm and persists active metrics mirror (usage default)", async () => {
    const root = tempDir("canon-optin-");
    const configDir = tempDir("canon-optin-cfg-");
    const refused = await collectionOptIn(root, { confirm: false, configDir });
    expect(refused.code).toBe(1);

    const fetchImpl = mockCollectorFetch();
    const collector = createCanonicalCollector(root, {
      configDir,
      fetch: fetchImpl,
      autoRegister: false,
    });
    const ok = await collectionOptIn(root, {
      confirm: true,
      configDir,
      collector,
    });
    expect(ok.code).toBe(0);
    const file = readCollectionFile(root);
    expect(file.metrics?.decision).toBe("active");
    expect(file.installId).toBe("11111111-1111-4111-8111-111111111111");
    expect(file.token).toBe("tok-test");
    expect(file.metrics?.scopes).toEqual(["usage"]);
    expect(file.submissions?.granted).not.toBe(true);
  });

  it("opt-out clears credentials and marks revoked", async () => {
    const root = tempDir("canon-optout-");
    const configDir = tempDir("canon-optout-cfg-");
    const fetchImpl = mockCollectorFetch();
    const collector = createCanonicalCollector(root, { configDir, fetch: fetchImpl });
    await collectionOptIn(root, { confirm: true, configDir, collector });

    const out = await collectionOptOut(root, { confirm: true, configDir, collector });
    expect(out.code).toBe(0);
    const file = readCollectionFile(root);
    expect(file.installId).toBeUndefined();
    expect(file.token).toBeUndefined();
    expect(file.metrics?.decision).toBe("revoked");
    expect(file.submissions?.granted).toBe(false);
  });
});
