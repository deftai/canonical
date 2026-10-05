/**
 * WP2 G1 [C]: CNT-2, CNT-3, CNT-4; PRIV-2 at the CLI / disk / fake-collector boundary.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

function writeState(root: string, state: Record<string, unknown>): void {
  const dir = join(root, ".canonical");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "collection.json"), `${JSON.stringify(state, null, 2)}\n`);
}

async function optInAnonymous(root: string) {
  return canon(["collection:opt-in", "--confirm"], { cwd: root });
}

describe("CNT contact (WP2)", () => {
  it("CNT-2: --show prints identity=<mode> only; --json is {code,message,mode}", async () => {
    const { root } = installCollectionHarness();
    await optInAnonymous(root);
    // Mark attributed without storing contact locally.
    writeState(root, { ...readCollectionState(root), attributed: true });

    const shown = await canon(["collection:identity", "--show"], { cwd: root });
    expect(shown.code).toBe(0);
    expect(shown.out).toBe("identity=identified\n");

    const json = await canon(["collection:identity", "--show", "--json"], { cwd: root });
    expect(json.code).toBe(0);
    const body = JSON.parse(json.out) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["code", "message", "mode"]);
    expect(body.mode).toBe("identified");
    expect(body.message).toBe("identity=identified");
  });

  it("CNT-3: --update validates, requires active track, one optIn replace; sets attributed", async () => {
    const { root, fake } = installCollectionHarness();

    const empty = await canon(["collection:identity", "--update"], { cwd: root });
    expect(empty.code).toBe(2);
    expect(fake.requests).toEqual([]);

    const bad = await canon(["collection:identity", "--update", "--email=not-an-email"], {
      cwd: root,
    });
    expect(bad.code).toBe(2);
    expect(fake.requests).toEqual([]);

    const noConsent = await canon(["collection:identity", "--update", "--email=ada@example.com"], {
      cwd: root,
    });
    expect(noConsent.code).toBe(1);
    expect(noConsent.err).toMatch(/opt in first/i);
    expect(fake.requests).toEqual([]);
    expect(readCollectionState(root)).toEqual({});

    await optInAnonymous(root);
    const metricsBefore = readCollectionState(root).metrics;
    fake.requests.length = 0;

    const ok = await canon(
      [
        "collection:identity",
        "--update",
        "--first-name=Ada",
        "--last-name=Lovelace",
        "--email=ada@example.com",
        "--mobile=+15551234567",
      ],
      { cwd: root },
    );
    expect(ok.code).toBe(0);
    const optins = fake.requests.filter((r) => r.path.includes("/optin"));
    expect(optins).toHaveLength(1);
    expect(fake.requests.some((r) => r.path.includes("/optout"))).toBe(false);
    const body = optins[0]?.body as { contact: Record<string, string>; scopes: string[] };
    expect(body.contact).toEqual({
      name: "Ada Lovelace",
      email: "ada@example.com",
      sms: "+15551234567",
    });
    expect(body.scopes).toContain("usage");
    expect(readCollectionState(root).attributed).toBe(true);
    expect(readCollectionState(root).metrics).toEqual(metricsBefore);
    expect(readCollectionState(root)).not.toHaveProperty("identity");

    // Rejection leaves local state unchanged.
    const beforeReject = readCollectionState(root);
    fake.failNext("optin", "denied");
    fake.requests.length = 0;
    const rejected = await canon(["collection:identity", "--update", "--email=bob@example.com"], {
      cwd: root,
    });
    expect(rejected.code).toBe(1);
    expect(readCollectionState(root)).toEqual(beforeReject);
  });

  it("CNT-4: --clear and opt-out --identity clear contact via optIn {}; never optOut", async () => {
    const { root, fake } = installCollectionHarness();
    await optInAnonymous(root);
    await canon(
      ["collection:identity", "--update", "--email=ada@example.com", "--first-name=Ada"],
      { cwd: root },
    );
    const metricsBefore = readCollectionState(root).metrics;
    const installId = readCollectionState(root).installId;
    fake.requests.length = 0;

    const cleared = await canon(["collection:identity", "--clear"], { cwd: root });
    expect(cleared.code).toBe(0);
    let optins = fake.requests.filter((r) => r.path.includes("/optin"));
    expect(optins).toHaveLength(1);
    let clearBody = optins[0]?.body as { contact: unknown };
    expect(clearBody.contact).toEqual({});
    expect(fake.requests.some((r) => r.path.includes("/optout"))).toBe(false);
    expect(readCollectionState(root).attributed).toBe(false);
    expect(readCollectionState(root).metrics).toEqual(metricsBefore);
    expect(readCollectionState(root).installId).toBe(installId);

    // Without credentials / active track: local flag only.
    writeState(root, { attributed: true });
    fake.requests.length = 0;
    const localOnly = await canon(["collection:identity", "--clear"], { cwd: root });
    expect(localOnly.code).toBe(0);
    expect(fake.requests).toEqual([]);
    expect(readCollectionState(root).attributed).toBe(false);

    // opt-out --identity is the same operation.
    await optInAnonymous(root);
    writeState(root, { ...readCollectionState(root), attributed: true });
    fake.requests.length = 0;
    const viaOptOut = await canon(["collection:opt-out", "--identity"], { cwd: root });
    expect(viaOptOut.code).toBe(0);
    optins = fake.requests.filter((r) => r.path.includes("/optin"));
    expect(optins).toHaveLength(1);
    clearBody = optins[0]?.body as { contact: unknown };
    expect(clearBody.contact).toEqual({});
    expect(fake.requests.some((r) => r.path.includes("/optout"))).toBe(false);
    expect(readCollectionState(root).attributed).toBe(false);
    expect(readCollectionState(root).installId).toBeDefined();
    expect((readCollectionState(root).metrics as { decision: string }).decision).toBe("active");
  });

  it("PRIV-2: contact values only on attributed opt-in / contact update optIn; never disk or stdio", async () => {
    const { root, fake } = installCollectionHarness();
    const email = "ada@example.com";
    const mobile = "+15551234567";

    const opted = await canon(
      [
        "collection:opt-in",
        "--confirm",
        "--first-name=Ada",
        "--last-name=Lovelace",
        "--email",
        email,
        "--mobile",
        mobile,
        "--json",
      ],
      { cwd: root },
    );
    expect(opted.code).toBe(0);
    expect(opted.out).not.toMatch(/ada@example\.com/i);
    expect(opted.out).not.toMatch(/Lovelace/);
    expect(opted.err).not.toMatch(/ada@example\.com/i);

    const statePath = join(root, ".canonical", "collection.json");
    expect(existsSync(statePath)).toBe(true);
    expect(readFileSync(statePath, "utf8")).not.toMatch(/ada@example\.com/i);
    expect(readFileSync(statePath, "utf8")).not.toMatch(/Lovelace/);
    expect(readFileSync(statePath, "utf8")).not.toMatch(/\+15551234567/);

    const contactOptIns = fake.requests.filter((r) => {
      if (!r.path.includes("/optin")) {
        return false;
      }
      const body = r.body as { contact?: Record<string, unknown> };
      return body.contact !== undefined && Object.keys(body.contact).length > 0;
    });
    expect(contactOptIns.length).toBe(1);
    const attributedBody = contactOptIns[0]?.body as { contact: unknown };
    expect(attributedBody.contact).toEqual({
      name: "Ada Lovelace",
      email,
      sms: mobile,
    });

    // Non-contact routes never carry contact values.
    for (const req of fake.requests) {
      if (req.path.includes("/optin")) {
        continue;
      }
      const blob = JSON.stringify(req.body ?? {});
      expect(blob).not.toMatch(/ada@example\.com/i);
      expect(blob).not.toMatch(/\+15551234567/);
    }

    fake.requests.length = 0;
    const updated = await canon(
      ["collection:identity", "--update", "--email=bob@example.com", "--first-name=Bob"],
      { cwd: root },
    );
    expect(updated.code).toBe(0);
    expect(updated.out).not.toMatch(/bob@example\.com/i);
    expect(updated.err).not.toMatch(/bob@example\.com/i);
    expect(readFileSync(statePath, "utf8")).not.toMatch(/bob@example\.com/i);
    const updateOptIns = fake.requests.filter((r) => r.path.includes("/optin"));
    expect(updateOptIns).toHaveLength(1);
    const updateBody = updateOptIns[0]?.body as { contact: unknown };
    expect(updateBody.contact).toEqual({
      name: "Bob",
      email: "bob@example.com",
    });
  });
});
