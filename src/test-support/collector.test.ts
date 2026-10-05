import { describe, expect, it } from "vitest";
import { COLLECTION_BASE_URL } from "../build-info.js";
import { fakeCollector } from "./collector.js";

const BASE = COLLECTION_BASE_URL.replace(/\/$/, "");

async function json(
  fake: ReturnType<typeof fakeCollector>,
  method: string,
  path: string,
  opts: {
    body?: unknown;
    token?: string;
    correlator?: string;
  } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-deft-deployment": "canonical:cli:staging:0.0.0",
  };
  if (opts.token !== undefined) {
    headers.authorization = `Bearer ${opts.token}`;
  }
  if (opts.correlator !== undefined) {
    headers["x-deft-correlator"] = opts.correlator;
  }
  let bodyStr: string | undefined;
  if (opts.body !== undefined) {
    const bodyObj = { ...(opts.body as object) } as Record<string, unknown>;
    if (opts.correlator !== undefined) {
      bodyObj.correlator = opts.correlator;
    }
    bodyStr = JSON.stringify(bodyObj);
  }
  const res = await fake.fetch(`${BASE}${path}`, {
    method,
    headers,
    ...(bodyStr !== undefined ? { body: bodyStr } : {}),
  });
  const text = await res.text();
  return {
    status: res.status,
    body: text.length > 0 ? (JSON.parse(text) as Record<string, unknown>) : {},
  };
}

async function register(fake: ReturnType<typeof fakeCollector>) {
  const res = await json(fake, "POST", "/v1/registrations", { body: { deployment_id: "x" } });
  expect(res.status).toBe(200);
  return {
    installId: res.body.install_id as string,
    token: res.body.install_token as string,
  };
}

describe("fakeCollector backend facts", () => {
  it("ARC-8: throws on URL outside the baked collector base", async () => {
    const fake = fakeCollector();
    await expect(fake.fetch("https://example.com/v1/registrations")).rejects.toThrow(
      /refused URL outside baked collector base/,
    );
  });

  it("B1: POST /optin replaces the installation scope set", async () => {
    const fake = fakeCollector();
    const { installId, token } = await register(fake);
    await json(fake, "POST", `/v1/registrations/${installId}/optin`, {
      token,
      body: { scopes: ["usage", "bug"], consent_version: "v1" },
    });
    const second = await json(fake, "POST", `/v1/registrations/${installId}/optin`, {
      token,
      body: { scopes: ["feedback"], consent_version: "v1" },
    });
    expect(second.body.scopes).toEqual(["feedback"]);
    expect(fake.installs.get(installId)?.scopes).toEqual(["feedback"]);
  });

  it("B2: contact omitted keeps; {} clears; object replaces; null/empty schema_invalid", async () => {
    const fake = fakeCollector();
    const { installId, token } = await register(fake);
    await json(fake, "POST", `/v1/registrations/${installId}/optin`, {
      token,
      body: {
        scopes: ["usage"],
        consent_version: "v1",
        contact: { name: "Ada", email: "ada@example.com" },
      },
    });
    expect(fake.installs.get(installId)?.contact).toEqual({
      name: "Ada",
      email: "ada@example.com",
    });

    await json(fake, "POST", `/v1/registrations/${installId}/optin`, {
      token,
      body: { scopes: ["usage"], consent_version: "v1" },
    });
    expect(fake.installs.get(installId)?.contact).toEqual({
      name: "Ada",
      email: "ada@example.com",
    });

    await json(fake, "POST", `/v1/registrations/${installId}/optin`, {
      token,
      body: {
        scopes: ["usage"],
        consent_version: "v1",
        contact: { sms: "+15551234567" },
      },
    });
    expect(fake.installs.get(installId)?.contact).toEqual({ sms: "+15551234567" });

    await json(fake, "POST", `/v1/registrations/${installId}/optin`, {
      token,
      body: { scopes: ["usage"], consent_version: "v1", contact: {} },
    });
    expect(fake.installs.get(installId)?.contact).toBeUndefined();

    const nullContact = await json(fake, "POST", `/v1/registrations/${installId}/optin`, {
      token,
      body: { scopes: ["usage"], consent_version: "v1", contact: null },
    });
    expect(nullContact.body.error).toBe("schema_invalid");

    const emptyStr = await json(fake, "POST", `/v1/registrations/${installId}/optin`, {
      token,
      body: { scopes: ["usage"], consent_version: "v1", contact: { email: "" } },
    });
    expect(emptyStr.body.error).toBe("schema_invalid");
  });

  it("B3: optout revokes; revoked refused on optin/challenge/submit; status answers", async () => {
    const fake = fakeCollector();
    const { installId, token } = await register(fake);
    await json(fake, "POST", `/v1/registrations/${installId}/optin`, {
      token,
      body: { scopes: ["usage"], consent_version: "v1" },
    });
    await json(fake, "POST", `/v1/registrations/${installId}/optout`, {
      token,
      body: {},
    });
    expect(fake.installs.get(installId)?.state).toBe("revoked");

    const optin = await json(fake, "POST", `/v1/registrations/${installId}/optin`, {
      token,
      body: { scopes: ["usage"], consent_version: "v1" },
    });
    expect(optin.body.error).toBe("revoked");

    const challenge = await json(fake, "POST", "/v1/challenge", {
      token,
      body: { install_id: installId, scope: "usage" },
    });
    expect(challenge.body.error).toBe("revoked");

    const submit = await json(fake, "POST", "/v1/submissions/usage", {
      token,
      body: {
        install_id: installId,
        nonce: "x",
        payload: { metric: "m", value: 1 },
      },
    });
    expect(submit.body.error).toBe("revoked");

    const status = await json(fake, "GET", `/v1/registrations/${installId}/status`, { token });
    expect(status.status).toBe(200);
    expect(status.body.state).toBe("revoked");
  });

  it("B4: each register mints a new install id; revoked id stays revoked", async () => {
    const fake = fakeCollector();
    const a = await register(fake);
    const b = await register(fake);
    expect(a.installId).not.toBe(b.installId);
    await json(fake, "POST", `/v1/registrations/${a.installId}/optin`, {
      token: a.token,
      body: { scopes: ["usage"], consent_version: "v1" },
    });
    await json(fake, "POST", `/v1/registrations/${a.installId}/optout`, {
      token: a.token,
      body: {},
    });
    const reuse = await json(fake, "POST", `/v1/registrations/${a.installId}/optin`, {
      token: a.token,
      body: { scopes: ["usage"], consent_version: "v1" },
    });
    expect(reuse.body.error).toBe("revoked");
  });

  it("B5: correlator header without body (or reverse) is correlator_mismatch", async () => {
    const fake = fakeCollector();
    const res = await fake.fetch(`${BASE}/v1/registrations`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-deft-deployment": "canonical:cli:staging:0.0.0",
        "x-deft-correlator": "only-header",
      },
      body: JSON.stringify({ deployment_id: "x" }),
    });
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("correlator_mismatch");
  });

  it("B6: pending not_opted_in; scope_not_consented; optin_expired via advance", async () => {
    const fake = fakeCollector();
    const { installId, token } = await register(fake);

    const pending = await json(fake, "POST", "/v1/challenge", {
      token,
      body: { install_id: installId, scope: "usage" },
    });
    expect(pending.body.error).toBe("not_opted_in");

    await json(fake, "POST", `/v1/registrations/${installId}/optin`, {
      token,
      body: { scopes: ["usage"], consent_version: "v1" },
    });
    const wrongScope = await json(fake, "POST", "/v1/challenge", {
      token,
      body: { install_id: installId, scope: "bug" },
    });
    expect(wrongScope.body.error).toBe("scope_not_consented");

    fake.advance(366 * 24 * 60 * 60 * 1000);
    const expired = await json(fake, "POST", "/v1/challenge", {
      token,
      body: { install_id: installId, scope: "usage" },
    });
    expect(expired.body.error).toBe("optin_expired");
  });

  it("B7: usage payload validated; contact keys rejected by schema", async () => {
    const fake = fakeCollector();
    const { installId, token } = await register(fake);
    await json(fake, "POST", `/v1/registrations/${installId}/optin`, {
      token,
      body: { scopes: ["usage"], consent_version: "v1" },
    });
    const challenge = await json(fake, "POST", "/v1/challenge", {
      token,
      body: { install_id: installId, scope: "usage" },
    });
    const nonce = challenge.body.nonce as string;
    const bad = await json(fake, "POST", "/v1/submissions/usage", {
      token,
      body: {
        install_id: installId,
        nonce,
        payload: { metric: "m", value: 1, email: "nope@example.com" },
      },
    });
    expect(bad.body.error).toBe("schema_invalid");
  });

  it("B8: expires_at is now + 365 days in epoch ms", async () => {
    const fake = fakeCollector();
    const before = fake.now();
    const { installId, token } = await register(fake);
    const res = await json(fake, "POST", `/v1/registrations/${installId}/optin`, {
      token,
      body: { scopes: ["usage"], consent_version: "v1" },
    });
    const expires = res.body.expires_at as number;
    expect(expires).toBe(before + 365 * 24 * 60 * 60 * 1000);
  });

  it("failNext forces the next matching route error", async () => {
    const fake = fakeCollector();
    fake.failNext("register", "rate_limited");
    const res = await json(fake, "POST", "/v1/registrations", { body: { deployment_id: "x" } });
    expect(res.body.error).toBe("rate_limited");
    const ok = await register(fake);
    expect(ok.installId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it("requests records method, path, headers and body", async () => {
    const fake = fakeCollector();
    await register(fake);
    expect(fake.requests.length).toBe(1);
    expect(fake.requests[0]?.method).toBe("POST");
    expect(fake.requests[0]?.path).toBe("/v1/registrations");
    expect(fake.requests[0]?.headers["x-deft-deployment"]).toBeDefined();
  });
});
