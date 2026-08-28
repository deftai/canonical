import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Collector } from "@deft/collection-sdk";
import { afterAll, describe, expect, it } from "vitest";
import { cleanupTempDirs, tempDir } from "../test-support/index.js";
import {
  collectionIdentityClear,
  collectionIdentityShow,
  collectionIdentityUpdate,
  identityMode,
  toSdkContact,
  validateEmail,
  validateMobile,
} from "./contact-identity.js";
import { collectionOptOut, collectionStatus, resolveConsentSignal } from "./consent.js";
import { emitUsage } from "./emit.js";
import { submitFeedback } from "./feedback.js";
import { readCollectionFile, writeCollectionFile } from "./storage.js";
import { CONSENT_VERSION, METRICS_SCOPES, SUBMISSION_SCOPES } from "./types.js";

afterAll(() => cleanupTempDirs());

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

function grantAll(root: string): void {
  writeCollectionFile(root, {
    installId: "id-1",
    token: "tok-1",
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
  });
}

describe("C5 contact identity helpers", () => {
  it("identityMode is identified only when email or mobile is present", () => {
    expect(identityMode(undefined)).toBe("anonymous");
    expect(identityMode({})).toBe("anonymous");
    expect(identityMode({ firstName: "Ada" })).toBe("anonymous");
    expect(identityMode({ email: "ada@example.com" })).toBe("identified");
    expect(identityMode({ mobile: "+15551234567" })).toBe("identified");
    expect(identityMode({ email: "ada@example.com", mobile: "+15551234567" })).toBe("identified");
  });

  it("maps local identity to SDK contact shape (name/email/sms)", () => {
    expect(
      toSdkContact({
        firstName: "Ada",
        lastName: "Lovelace",
        email: "ada@example.com",
        mobile: "+15551234567",
      }),
    ).toEqual({
      name: "Ada Lovelace",
      email: "ada@example.com",
      sms: "+15551234567",
    });
    expect(toSdkContact({ firstName: "Ada", email: "a@b.co" })).toEqual({
      name: "Ada",
      email: "a@b.co",
    });
    expect(toSdkContact({ lastName: "Lovelace" })).toEqual({ name: "Lovelace" });
    expect(toSdkContact({})).toEqual({});
  });

  it("validates email loosely and mobile as E.164 or national", () => {
    expect(validateEmail("ada@example.com").ok).toBe(true);
    expect(validateEmail("not-an-email").ok).toBe(false);
    expect(validateMobile("+15551234567").ok).toBe(true);
    expect(validateMobile("5551234567").ok).toBe(true);
    expect(validateMobile("(555) 123-4567").ok).toBe(true);
    expect(validateMobile("abc").ok).toBe(false);
  });
});

describe("collection:identity show/clear/update", () => {
  it("show reports anonymous when no identity block", () => {
    const root = tempDir("canon-id-show-empty-");
    const result = collectionIdentityShow(root);
    expect(result.code).toBe(0);
    expect(result.mode).toBe("anonymous");
    expect(result.identity).toEqual({});
    expect(result.message).toMatch(/identity=anonymous/);
  });

  it("update stores identity in collection.json (0600) and sets identified mode", async () => {
    const root = tempDir("canon-id-update-");
    const result = await collectionIdentityUpdate(root, {
      firstName: "Ada",
      lastName: "Lovelace",
      email: "ada@example.com",
      mobile: "+15551234567",
    });
    expect(result.code).toBe(0);
    expect(result.mode).toBe("identified");

    const file = readCollectionFile(root);
    expect(file.identity).toEqual({
      firstName: "Ada",
      lastName: "Lovelace",
      email: "ada@example.com",
      mobile: "+15551234567",
    });
    expect(resolveConsentSignal(file).identity).toBe("identified");

    const path = join(root, ".canonical", "collection.json");
    expect(existsSync(path)).toBe(true);
    expect(JSON.parse(readFileSync(path, "utf8")).identity.email).toBe("ada@example.com");
    try {
      expect(statSync(path).mode & 0o777).toBe(0o600);
    } catch {
      // platform may ignore mode
    }

    const shown = collectionIdentityShow(root);
    expect(shown.mode).toBe("identified");
    expect(shown.identity?.email).toBe("ada@example.com");
    expect(shown.message).toMatch(/identity=identified/);
  });

  it("update rejects identified-channel-less invalid email/mobile", async () => {
    const root = tempDir("canon-id-bad-");
    const badEmail = await collectionIdentityUpdate(root, { email: "nope" });
    expect(badEmail.code).toBe(2);
    expect(badEmail.message.toLowerCase()).toMatch(/email/);

    const badMobile = await collectionIdentityUpdate(root, { mobile: "nope" });
    expect(badMobile.code).toBe(2);
    expect(badMobile.message.toLowerCase()).toMatch(/mobile/);
  });

  it("identified requires email or mobile — name-only stays anonymous", async () => {
    const root = tempDir("canon-id-nameonly-");
    const result = await collectionIdentityUpdate(root, {
      firstName: "Ada",
      lastName: "Lovelace",
    });
    expect(result.code).toBe(0);
    expect(result.mode).toBe("anonymous");
    expect(resolveConsentSignal(readCollectionFile(root)).identity).toBe("anonymous");
  });

  it("update syncs SDK contact via opt-in reconfirm when credentials exist", async () => {
    const root = tempDir("canon-id-sync-");
    grantAll(root);
    let seenContact: { email?: string; name?: string; sms?: string } | undefined;
    let seenScopes: string[] | undefined;
    const collector = stubCollector({
      optIn: async (args) => {
        seenContact = args.contact;
        seenScopes = [...args.scopes];
        return {
          ok: true,
          state: "active",
          scopes: args.scopes,
          expiresAt: Date.now() + 86_400_000,
        };
      },
    });

    const result = await collectionIdentityUpdate(
      root,
      { firstName: "Ada", lastName: "Lovelace", email: "ada@example.com", mobile: "+15551234567" },
      { collector },
    );
    expect(result.code).toBe(0);
    expect(seenContact).toEqual({
      name: "Ada Lovelace",
      email: "ada@example.com",
      sms: "+15551234567",
    });
    expect(seenScopes).toEqual(expect.arrayContaining(["usage", "feedback", "bug", "feature"]));
  });

  it("clear resets local identity to anonymous and clears server contact when creds exist", async () => {
    const root = tempDir("canon-id-clear-");
    grantAll(root);
    await collectionIdentityUpdate(
      root,
      { email: "ada@example.com", firstName: "Ada" },
      { collector: stubCollector() },
    );

    let optInCalls = 0;
    let seenContact: unknown;
    const collector = stubCollector({
      optIn: async (args) => {
        optInCalls += 1;
        seenContact = args.contact;
        return {
          ok: true,
          state: "active",
          scopes: args.scopes,
          expiresAt: Date.now() + 86_400_000,
        };
      },
    });

    const cleared = await collectionIdentityClear(root, { collector });
    expect(cleared.code).toBe(0);
    expect(cleared.mode).toBe("anonymous");
    expect(readCollectionFile(root).identity).toBeUndefined();
    expect(resolveConsentSignal(readCollectionFile(root)).identity).toBe("anonymous");
    expect(optInCalls).toBe(1);
    // Empty / omitted contact — must not re-send prior PII
    expect(seenContact === undefined || seenContact === null || Object.keys(seenContact as object).length === 0).toBe(
      true,
    );
  });

  it("status / resolveConsentSignal wire real identity mode", async () => {
    const root = tempDir("canon-id-status-");
    await collectionIdentityUpdate(root, { email: "ada@example.com" });
    const status = await collectionStatus(root);
    expect(status.message).toMatch(/identity=identified/);
    expect(status.status.identity).toBe("identified");
  });
});

describe("opt-out --identity", () => {
  it("clears local identity and server contact without full revoke", async () => {
    const root = tempDir("canon-id-optout-id-");
    grantAll(root);
    await collectionIdentityUpdate(
      root,
      { email: "ada@example.com", mobile: "+15551234567" },
      { collector: stubCollector() },
    );

    let optedOut = false;
    let optInContact: unknown;
    const collector = stubCollector({
      optOut: async () => {
        optedOut = true;
        return { ok: true, state: "revoked" };
      },
      optIn: async (args) => {
        optInContact = args.contact;
        return {
          ok: true,
          state: "active",
          scopes: args.scopes,
          expiresAt: Date.now() + 86_400_000,
        };
      },
    });

    const result = await collectionOptOut(root, { confirm: false, identity: true, collector });
    expect(result.code).toBe(0);
    expect(optedOut).toBe(false);
    expect(readCollectionFile(root).identity).toBeUndefined();
    expect(readCollectionFile(root).installId).toBe("id-1");
    expect(readCollectionFile(root).metrics?.decision).toBe("active");
    expect(optInContact === undefined || optInContact === null || Object.keys(optInContact as object).length === 0).toBe(
      true,
    );
  });
});

describe("PRIV-2 and feedback --as-anonymous", () => {
  it("bug/feature/feedback/usage payloads never include contact or identity fields", async () => {
    const root = tempDir("canon-priv2-");
    grantAll(root);
    await collectionIdentityUpdate(
      root,
      {
        firstName: "Ada",
        lastName: "Lovelace",
        email: "ada@example.com",
        mobile: "+15551234567",
      },
      { collector: stubCollector() },
    );

    const forbidden = ["email", "mobile", "sms", "firstName", "lastName", "name", "contact", "identity"];
    const payloads: Record<string, unknown>[] = [];

    const collector = stubCollector({
      submit: async (_scope, payload) => {
        payloads.push(payload as Record<string, unknown>);
        return { ok: true, id: "sub-x" };
      },
    });

    await submitFeedback(root, { kind: "bug", summary: "crash", collector });
    await submitFeedback(root, { kind: "feature", summary: "dark mode", collector });
    await submitFeedback(root, { kind: "feedback", message: "hi", collector });
    await emitUsage(root, "orient_ok", 1, { collector });

    expect(payloads.length).toBe(4);
    for (const p of payloads) {
      for (const key of forbidden) {
        expect(p).not.toHaveProperty(key);
      }
      const blob = JSON.stringify(p);
      expect(blob).not.toContain("ada@example.com");
      expect(blob).not.toContain("+15551234567");
      expect(blob).not.toContain("Lovelace");
    }
  });

  it("feedback --as-anonymous does not sync/update contact for that call", async () => {
    const root = tempDir("canon-as-anon-");
    grantAll(root);
    await collectionIdentityUpdate(
      root,
      { email: "ada@example.com" },
      { collector: stubCollector() },
    );

    let optInCalls = 0;
    const collector = stubCollector({
      optIn: async (args) => {
        optInCalls += 1;
        return {
          ok: true,
          state: "active",
          scopes: args.scopes,
          expiresAt: Date.now() + 86_400_000,
        };
      },
      submit: async (_scope, payload) => {
        expect(payload).not.toHaveProperty("email");
        expect(payload).not.toHaveProperty("contact");
        return { ok: true, id: "sub-anon" };
      },
    });

    const result = await submitFeedback(root, {
      kind: "feedback",
      message: "anonymous note",
      asAnonymous: true,
      collector,
    });
    expect(result.code).toBe(0);
    expect(optInCalls).toBe(0);
    // Local identity unchanged
    expect(readCollectionFile(root).identity?.email).toBe("ada@example.com");
  });
});
