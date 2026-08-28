import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cleanupTempDirs, tempDir } from "../test-support/index.js";
import { createCanonicalCollector } from "./client.js";

afterAll(() => cleanupTempDirs());

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("createCanonicalCollector correlator wiring (C3)", () => {
  it("emits a 4-segment deployment id with no customer uuid", async () => {
    const root = tempDir("canon-c3-dep-");
    const configDir = tempDir("canon-c3-dep-cfg-");
    const userKey = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "identity.json"), `${JSON.stringify({ userKey }, null, 2)}\n`, {
      encoding: "utf8",
    });

    let seenDeployment: string | undefined;
    let seenHeaderCorrelator: string | undefined;
    let seenBodyCorrelator: string | undefined;
    let seenBodyDeployment: string | undefined;

    const fetchImpl: typeof fetch = async (_input, init) => {
      const headers = new Headers(init?.headers);
      seenDeployment = headers.get("x-deft-deployment") ?? undefined;
      seenHeaderCorrelator = headers.get("x-deft-correlator") ?? undefined;
      if (typeof init?.body === "string") {
        const parsed = JSON.parse(init.body) as {
          correlator?: string;
          deployment_id?: string;
        };
        seenBodyCorrelator = parsed.correlator;
        seenBodyDeployment = parsed.deployment_id;
      }
      return jsonResponse(200, {
        install_id: "11111111-1111-4111-8111-111111111111",
        install_token: "tok-test",
        state: "pending",
      });
    };

    const collector = createCanonicalCollector(root, {
      configDir,
      fetch: fetchImpl,
      autoRegister: false,
      version: "0.3.0",
      environment: "staging",
    });
    const registered = await collector.ensureRegistered();
    expect(registered.ok).toBe(true);

    expect(seenDeployment).toBe("canonical:cli:staging:0.3.0");
    expect(seenDeployment?.split(":")).toHaveLength(4);
    expect(seenDeployment).not.toContain(userKey);
    expect(seenBodyDeployment).toBe("canonical:cli:staging:0.3.0");
    expect(seenHeaderCorrelator).toBe(userKey);
    expect(seenBodyCorrelator).toBe(userKey);
  });

  it("sends correlator header+body when identity already exists", async () => {
    const root = tempDir("canon-c3-corr-");
    const configDir = tempDir("canon-c3-corr-cfg-");
    const userKey = "11111111-2222-4333-8444-555555555555";
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "identity.json"), `${JSON.stringify({ userKey }, null, 2)}\n`);

    const seen: Array<{ header?: string; body?: string }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      const headerCorr = headers.get("x-deft-correlator") ?? undefined;
      let bodyCorr: string | undefined;
      if (typeof init?.body === "string") {
        bodyCorr = (JSON.parse(init.body) as { correlator?: string }).correlator;
      }
      seen.push({ header: headerCorr, body: bodyCorr });

      if (url.endsWith("/v1/registrations")) {
        return jsonResponse(200, {
          install_id: "11111111-1111-4111-8111-111111111111",
          install_token: "tok-test",
          state: "pending",
        });
      }
      if (url.includes("/optin")) {
        return jsonResponse(200, {
          state: "active",
          scopes: ["usage"],
          expires_at: Date.now() + 86_400_000,
        });
      }
      return jsonResponse(404, { error: "not_found" });
    };

    const collector = createCanonicalCollector(root, {
      configDir,
      fetch: fetchImpl,
      autoRegister: false,
    });
    await collector.ensureRegistered();
    await collector.optIn({ scopes: ["usage"], consentVersion: "canonical-2026-09-a" });

    expect(seen.length).toBeGreaterThanOrEqual(2);
    for (const call of seen) {
      expect(call.header).toBe(userKey);
      expect(call.body).toBe(userKey);
    }
  });
});
