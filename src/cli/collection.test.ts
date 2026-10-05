/**
 * WP1 characterization: [P] requirements at the CLI / disk / fake-collector boundary.
 */
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { COLLECTION_BASE_URL, COLLECTION_ENV } from "../build-info.js";
import {
  CLI_FLAG_TABLE,
  canon,
  cleanupTempDirs,
  extractAgentActionsSection,
  extractCollectionFeedbackSection,
  extractDocsCliUsage,
  extractPhase8,
  extractUnreleased,
  extractUserDialogueSection,
  git,
  hasForbiddenNameFlag,
  installCollectionHarness,
  installCollectionTestHooks,
  readCollectionState,
  writeScopeFixture,
} from "../test-support/index.js";

installCollectionTestHooks();
afterAll(() => cleanupTempDirs());

const CONSENT_VERSION = "canonical-2026-09-b";
const CONTACT_KEYS = [
  "email",
  "mobile",
  "sms",
  "firstName",
  "lastName",
  "name",
  "contact",
  "identity",
] as const;

function writeState(root: string, state: Record<string, unknown>): void {
  const dir = join(root, ".canonical");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "collection.json"), `${JSON.stringify(state, null, 2)}\n`);
}

function activeMetrics(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    installId: "11111111-1111-4111-8111-111111111111",
    token: "tok-seed",
    metrics: {
      decision: "active",
      scopes: ["usage"],
      consentVersion: CONSENT_VERSION,
      decidedAt: "2026-01-01T00:00:00.000Z",
      expiresAt: Date.now() + 86_400_000,
    },
    metricsMode: "anonymous",
    ...extra,
  };
}

function submissionPayloads(fake: {
  installs: Map<string, { submissions: Array<{ scope: string; payload: unknown }> }>;
}): Array<{ scope: string; payload: unknown }> {
  const out: Array<{ scope: string; payload: unknown }> = [];
  for (const install of fake.installs.values()) {
    out.push(...install.submissions);
  }
  return out;
}

function usagePayloads(fake: {
  installs: Map<string, { submissions: Array<{ scope: string; payload: unknown }> }>;
}): Array<Record<string, unknown>> {
  return submissionPayloads(fake)
    .filter((s) => s.scope === "usage")
    .map((s) => s.payload as Record<string, unknown>);
}

async function optInAnonymous(root: string) {
  return canon(["collection:opt-in", "--confirm"], { cwd: root });
}

describe("FLOW / STO / SIG", () => {
  it("FLOW-1: User dialogue section of content/feedback.md is byte-identical to the baseline pin", () => {
    const text = readFileSync(join(process.cwd(), "content/feedback.md"), "utf8");
    const section = extractUserDialogueSection(text);
    const pin = readFileSync(
      join(process.cwd(), "src/test-support/feedback-user-dialogue.fixture.txt"),
      "utf8",
    );
    expect(section).toBe(pin);
  });

  it("FLOW-4: Agent actions and Collection & Feedback docs drop removed flags and correlator text", () => {
    const feedback = readFileSync(join(process.cwd(), "content/feedback.md"), "utf8");
    const tasks = readFileSync(join(process.cwd(), "content/canonical-tasks.md"), "utf8");
    const agent = extractAgentActionsSection(feedback);
    const collection = extractCollectionFeedbackSection(tasks);
    // Header is also edited in WP4 G2; whole-file check matches EXECUTION §3.4.
    for (const [label, text] of [
      ["content/feedback.md", feedback],
      ["Agent actions", agent],
      ["Collection & Feedback", collection],
    ] as const) {
      expect(text, `${label} must not mention --live`).not.toMatch(/--live\b/);
      expect(text, `${label} must not mention --scopes`).not.toMatch(/--scopes\b/);
      expect(text, `${label} must not mention --consent-version`).not.toMatch(
        /--consent-version\b/,
      );
      expect(text, `${label} must not mention correlator`).not.toMatch(/correlator/);
      expect(text, `${label} must not mention userKey`).not.toMatch(/userKey/);
      expect(text, `${label} must not mention ~/.config/canonical`).not.toMatch(
        /~\/\.config\/canonical/,
      );
      expect(hasForbiddenNameFlag(text), `${label} must not mention --name flag`).toBe(false);
    }
    // Required post-refactor documentation (fails until implementor updates).
    expect(agent).toMatch(/--disclosure-accepted(?!\])/);
    expect(agent).toMatch(/channel=(staging|production)| channel=/);
    expect(collection).toMatch(/--first-name/);
    expect(collection).toMatch(/--last-name/);
    expect(collection).toMatch(/--disclosure-accepted(?!\])/);
    expect(collection).toMatch(/channel=(staging|production)| channel=/);
  });

  it("FLOW-5: every collection:* / feedback verb and flag in content/*.md is in the CLI tables", () => {
    const { verbs, pairs } = extractDocsCliUsage();
    expect(verbs.length).toBeGreaterThan(0);
    for (const verb of verbs) {
      expect(CLI_FLAG_TABLE, `unknown verb in docs: ${verb}`).toHaveProperty(verb);
    }
    const rejected = pairs.filter((p) => {
      const table = CLI_FLAG_TABLE[p.verb];
      return table === undefined || !table.has(p.flag);
    });
    expect(rejected, rejected.map((p) => `${p.file}: ${p.verb} --${p.flag}`).join("\n")).toEqual(
      [],
    );
  });

  it("FLOW-6: content/feedback.md MUST NOT exceed 118 lines", () => {
    const text = readFileSync(join(process.cwd(), "content/feedback.md"), "utf8");
    // wc -l semantics: count newline characters.
    const lineCount =
      text.length === 0
        ? 0
        : text.endsWith("\n")
          ? text.split("\n").length - 1
          : text.split("\n").length;
    expect(lineCount).toBeLessThanOrEqual(118);
  });

  it("FLOW-7: Phase 8, ARCHITECTURE.md, and CHANGELOG [Unreleased] reflect the refactor", () => {
    const manual = readFileSync(join(process.cwd(), "docs/manual-test-plan.md"), "utf8");
    const architecture = readFileSync(join(process.cwd(), "docs/ARCHITECTURE.md"), "utf8");
    const changelog = readFileSync(join(process.cwd(), "CHANGELOG.md"), "utf8");

    const phase8 = extractPhase8(manual);
    expect(phase8).not.toMatch(/--live\b/);
    // Real captured output includes the channel= suffix (not ellipsis placeholders only).
    expect(phase8).toMatch(/channel=(staging|production)/);

    expect(architecture).toMatch(/\.canonical\/collection\.json/);
    expect(architecture).not.toMatch(/correlator/);
    expect(architecture).not.toMatch(/userKey/);

    const unreleased = extractUnreleased(changelog);
    expect(unreleased, "CHANGELOG.md must have an [Unreleased] section").not.toBeNull();
    const body = unreleased ?? "";
    expect(body.toLowerCase()).toMatch(
      /contact.*(?:no longer|not) stored locally|not stored locally/,
    );
    expect(body).toMatch(/identity\.json/);
    expect(body.toLowerCase()).toMatch(/machine-level|correlator|installId/);
    expect(body).toMatch(/--live/);
    expect(body).toMatch(/--scopes|--consent-version|--name/);
  });

  it("STO-1: collection.json is mode 0600; init keeps collection paths in .gitignore", async () => {
    const { root } = installCollectionHarness();
    const opted = await optInAnonymous(root);
    expect(opted.code).toBe(0);
    const path = join(root, ".canonical", "collection.json");
    expect(existsSync(path)).toBe(true);
    const mode = statSync(path).mode & 0o777;
    expect(mode).toBe(0o600);

    const init = await canon(["init"], { cwd: root });
    expect(init.code).toBe(0);
    const gitignore = readFileSync(join(root, ".gitignore"), "utf8");
    expect(gitignore).toContain(".canonical/collection.json");
    expect(gitignore).toContain(".canonical/collection-session.json");
    expect(gitignore).toContain(".canonical/collection-inventory.json");
  });

  it("STO-5: missing, unreadable, or unparseable collection.json reads as empty (not_prompted)", async () => {
    const { root, fake } = installCollectionHarness();
    const missing = await canon(["collection:status"], { cwd: root });
    expect(missing.code).toBe(1);
    expect(missing.err).toMatch(/metrics=not_prompted/);

    writeState(root, {});
    writeFileSync(join(root, ".canonical", "collection.json"), "{not-json");
    const bad = await canon(["collection:status"], { cwd: root });
    expect(bad.code).toBe(1);
    expect(bad.err).toMatch(/metrics=not_prompted/);

    writeState(root, {
      metrics: {
        decision: "active",
        scopes: ["usage"],
        consentVersion: CONSENT_VERSION,
        decidedAt: "2026-01-01T00:00:00.000Z",
        expiresAt: Date.now() + 86_400_000,
      },
      submissions: {
        granted: true,
        scopes: ["bug", "feedback", "feature"],
        consentVersion: CONSENT_VERSION,
        decidedAt: "2026-01-01T00:00:00.000Z",
        expiresAt: Date.now() + 86_400_000,
      },
    });
    chmodSync(join(root, ".canonical", "collection.json"), 0o000);
    try {
      const unreadable = await canon(["collection:status"], { cwd: root });
      expect(unreadable.code).toBe(1);
      expect(`${unreadable.out}${unreadable.err}`).toMatch(/metrics=not_prompted/);
    } finally {
      chmodSync(join(root, ".canonical", "collection.json"), 0o600);
    }

    // Credential adapter save keeps consent fields (decline + disclosed feedback registers).
    writeState(root, {
      metrics: {
        decision: "declined",
        scopes: [],
        consentVersion: CONSENT_VERSION,
        decidedAt: "2026-01-01T00:00:00.000Z",
      },
      metricsMode: "disallowed",
    });
    const granted = await canon(
      ["feedback", "--kind=bug", "--summary=boom", "--disclosure-accepted"],
      { cwd: root },
    );
    expect(granted.code).toBe(0);
    const afterSave = readCollectionState(root);
    expect((afterSave.metrics as { decision: string }).decision).toBe("declined");
    expect(typeof afterSave.installId).toBe("string");
    expect(typeof afterSave.token).toBe("string");
    expect(fake.installs.size).toBe(1);
  });

  it("SIG-1: consent line shape on status and orient --json keys", async () => {
    const { root } = installCollectionHarness();
    const status = await canon(["collection:status"], { cwd: root });
    expect(status.err).toMatch(
      /^metricsMode=undecided metrics=not_prompted submissions=not_granted identity=anonymous channel=(staging|production)\n$/,
    );

    const orient = await canon(["orient", "--json", "--allow-dirty"], { cwd: root });
    expect(orient.code).toBe(0);
    const parsed = JSON.parse(orient.out) as Record<string, unknown>;
    for (const key of [
      "consent",
      "consent_line",
      "identity",
      "identity_mode",
      "metrics",
      "metrics_mode",
      "submissions",
    ]) {
      expect(parsed).toHaveProperty(key);
    }
    expect(String(parsed.consent_line)).toMatch(
      /^metricsMode=\w+ metrics=\w+ submissions=\w+ identity=\w+$/,
    );
  });

  it("SIG-2: derivation for declined, revoked, expired, active, submissions", async () => {
    const { root } = installCollectionHarness();

    writeState(root, {
      metrics: {
        decision: "declined",
        scopes: [],
        consentVersion: CONSENT_VERSION,
        decidedAt: "2026-01-01T00:00:00.000Z",
      },
      metricsMode: "disallowed",
    });
    let r = await canon(["collection:status"], { cwd: root });
    expect(r.err).toMatch(/metricsMode=disallowed metrics=declined/);

    writeState(root, {
      metrics: {
        decision: "revoked",
        scopes: [],
        consentVersion: CONSENT_VERSION,
        decidedAt: "2026-01-01T00:00:00.000Z",
      },
      metricsMode: "disallowed",
    });
    r = await canon(["collection:status"], { cwd: root });
    expect(r.err).toMatch(/metricsMode=disallowed metrics=revoked/);

    writeState(root, {
      metrics: {
        decision: "active",
        scopes: ["usage"],
        consentVersion: CONSENT_VERSION,
        decidedAt: "2026-01-01T00:00:00.000Z",
        expiresAt: 1,
      },
      metricsMode: "anonymous",
    });
    r = await canon(["collection:status"], { cwd: root });
    expect(r.err).toMatch(/metricsMode=undecided metrics=expired/);

    writeState(root, {
      ...activeMetrics({
        identity: { email: "ada@example.com" },
        metricsMode: "attributed",
        submissions: {
          granted: true,
          scopes: ["bug", "feedback", "feature"],
          consentVersion: CONSENT_VERSION,
          decidedAt: "2026-01-01T00:00:00.000Z",
          expiresAt: Date.now() + 86_400_000,
        },
      }),
    });
    r = await canon(["collection:status"], { cwd: root });
    expect(r.code).toBe(0);
    expect(r.out).toMatch(
      /metricsMode=attributed metrics=active submissions=granted identity=identified/,
    );
  });

  it("SIG-4: collection:status exit codes, channel suffix, and --json keys", async () => {
    const { root } = installCollectionHarness();
    const empty = await canon(["collection:status", "--json"], { cwd: root });
    expect(empty.code).toBe(1);
    const parsed = JSON.parse(empty.out) as Record<string, unknown>;
    for (const key of [
      "channel",
      "code",
      "consent_version",
      "expires_at",
      "identity",
      "identity_mode",
      "install_id",
      "message",
      "metrics",
      "metrics_mode",
      "prompt_state",
      "scopes",
      "submissions",
    ]) {
      expect(parsed).toHaveProperty(key);
    }
    expect(parsed.channel).toMatch(/^(staging|production)$/);

    writeState(root, activeMetrics());
    const active = await canon(["collection:status"], { cwd: root });
    expect(active.code).toBe(0);
    expect(active.out).toMatch(/ channel=(staging|production)\n$/);
  });
});

describe("CON consent verbs", () => {
  it("CON-1: nothing registered before explicit opt-in or disclosed feedback", async () => {
    const { root, fake } = installCollectionHarness();
    await canon(["collection:status"], { cwd: root });
    await canon(["collection:decline"], { cwd: root });
    await canon(["collection:metric", "--metric=orient_ok", "--value=1"], { cwd: root });
    expect(fake.requests).toEqual([]);
    expect(fake.installs.size).toBe(0);
  });

  it("CON-2: collection:decline makes no network call; records declined; --json {code,message}", async () => {
    const { root, fake } = installCollectionHarness();
    writeState(root, {
      installId: "keep-id",
      token: "keep-tok",
      submissions: {
        granted: true,
        scopes: ["bug", "feedback", "feature"],
        consentVersion: CONSENT_VERSION,
        decidedAt: "2026-01-01T00:00:00.000Z",
        expiresAt: Date.now() + 86_400_000,
      },
      identity: { email: "ada@example.com" },
    });
    const result = await canon(["collection:decline", "--json"], { cwd: root });
    expect(result.code).toBe(0);
    expect(fake.requests).toEqual([]);
    const body = JSON.parse(result.out) as { code: number; message: string };
    expect(body).toEqual({
      code: 0,
      message: "collection: declined metricsMode=disallowed",
    });
    const state = readCollectionState(root);
    expect(state.installId).toBe("keep-id");
    expect(state.token).toBe("keep-tok");
    expect((state.metrics as { decision: string }).decision).toBe("declined");
    // D4/STO-3: presence of submissions means granted (no `granted` boolean in the new shape).
    expect(state.submissions).toBeDefined();
  });

  it("CON-3: opt-in without --confirm exits 1, no network, no state change", async () => {
    const { root, fake } = installCollectionHarness();
    const result = await canon(["collection:opt-in"], { cwd: root });
    expect(result.code).toBe(1);
    expect(result.err).toMatch(/collection:opt-in requires --confirm/);
    expect(fake.requests).toEqual([]);
    expect(readCollectionState(root)).toEqual({});
  });

  it("CON-7: invalid email or mobile exits 2; identity update sends nothing", async () => {
    const { root, fake } = installCollectionHarness();
    // Identity update validates before any network.
    const badMobile = await canon(["collection:identity", "--update", "--mobile=abc"], {
      cwd: root,
    });
    expect(badMobile.code).toBe(2);
    expect(fake.requests).toEqual([]);

    // Opt-in with invalid email: baseline may register+optIn before validation
    // fails (ensureAttributedOptIn order); still exits 2.
    const before = fake.requests.length;
    const badEmail = await canon(["collection:opt-in", "--confirm", "--email=not-an-email"], {
      cwd: root,
    });
    expect(badEmail.code).toBe(2);
    expect(fake.requests.length).toBeGreaterThanOrEqual(before);
  });

  it("CON-8: register failure and missing usage scope handling", async () => {
    const { root, fake } = installCollectionHarness();
    fake.failNext("register", "rate_limited");
    const regFail = await canon(["collection:opt-in", "--confirm"], { cwd: root });
    expect(regFail.code).toBe(2);
    expect(regFail.err).toMatch(/collection:opt-in register failed -- rate_limited/);

    fake.failNext("optin", "denied");
    const rejected = await canon(["collection:opt-in", "--confirm"], { cwd: root });
    expect(rejected.code).toBe(1);
    expect(rejected.err).toMatch(/collection:opt-in rejected -- denied/);
  });

  it("CON-8: response without usage does not record usage granted", async () => {
    const { root, fake } = installCollectionHarness();
    // Seed active metrics, then force opt-in to return scopes without usage via fail?
    // Use a custom fetch wrapper: succeed register, optin returns scopes without usage.
    const baseFetch = fake.fetch;
    let optInCount = 0;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/optin")) {
        optInCount += 1;
        if (optInCount === 1) {
          // First allow normal for register path — actually this is optin only.
          return new Response(
            JSON.stringify({
              state: "active",
              scopes: ["feedback"],
              expires_at: Date.now() + 86_400_000,
              contact_verified: false,
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
      }
      return baseFetch(input, init);
    });

    writeState(root, activeMetrics());
    // Need real credentials matching fake OR go through register. Clear and opt-in fresh:
    writeState(root, {
      metrics: {
        decision: "active",
        scopes: ["usage"],
        consentVersion: CONSENT_VERSION,
        decidedAt: "2026-01-01T00:00:00.000Z",
        expiresAt: Date.now() + 86_400_000,
      },
      metricsMode: "anonymous",
    });
    const result = await canon(["collection:opt-in", "--confirm"], { cwd: root });
    expect(result.code).toBe(1);
    expect(result.err).toMatch(/server did not grant usage scope/);
    const state = readCollectionState(root);
    expect((state.metrics as { decision: string }).decision).toBe("revoked");
  });

  it("CON-9: successful opt-in records active, prints scopes, --json shape", async () => {
    const { root, fake } = installCollectionHarness();
    const result = await canon(["collection:opt-in", "--confirm", "--json"], { cwd: root });
    expect(result.code).toBe(0);
    const body = JSON.parse(result.out) as {
      code: number;
      message: string;
      metricsMode: string | null;
      scopes: string[];
    };
    expect(body.code).toBe(0);
    expect(body.scopes).toEqual(["usage"]);
    expect(body.message).toMatch(/collection: opted in scopes=\[usage\] metricsMode=anonymous/);
    // Baseline --json.metricsMode MAY be null; mode is carried in the message.
    expect([null, "anonymous", "attributed"]).toContain(body.metricsMode);
    const state = readCollectionState(root);
    expect((state.metrics as { decision: string; expiresAt: number }).decision).toBe("active");
    expect((state.metrics as { expiresAt: number }).expiresAt).toBeGreaterThan(Date.now());
    expect(typeof state.installId).toBe("string");
    expect(typeof state.token).toBe("string");
    expect(fake.installs.size).toBe(1);
  });

  it("CON-10: opt-out without --confirm exits 1; with --confirm runs full opt-out", async () => {
    const { root } = installCollectionHarness();
    const refused = await canon(["collection:opt-out"], { cwd: root });
    expect(refused.code).toBe(1);
    expect(refused.err).toMatch(/collection:opt-out requires --confirm/);

    await optInAnonymous(root);
    const out = await canon(["collection:opt-out", "--confirm"], { cwd: root });
    expect(out.code).toBe(0);
    expect(out.out).toMatch(/collection: opted out metricsMode=disallowed \(install rotated\)/);
  });

  it("CON-11: full opt-out calls server first; on success clears credentials", async () => {
    const { root, fake } = installCollectionHarness();
    await optInAnonymous(root);
    const installId = [...fake.installs.keys()][0];
    expect(installId).toBeDefined();

    fake.failNext("optout", "denied");
    const rejected = await canon(["collection:opt-out", "--confirm"], { cwd: root });
    expect(rejected.code).toBe(1);
    expect(rejected.err).toMatch(/collection:opt-out rejected -- denied/);
    expect(readCollectionState(root).installId).toBeDefined();

    const ok = await canon(["collection:opt-out", "--confirm"], { cwd: root });
    expect(ok.code).toBe(0);
    expect(ok.out).toMatch(/collection: opted out metricsMode=disallowed \(install rotated\)/);
    const state = readCollectionState(root);
    expect(state.installId).toBeUndefined();
    expect(state.token).toBeUndefined();
    expect((state.metrics as { decision: string }).decision).toBe("revoked");
    expect(state).not.toHaveProperty("attributed");
    // Baseline still writes submissions:{granted:false} + metricsMode; CON-11's
    // "only a revoked metrics record / no submissions" overlaps STO-3 [C] shape — see report.
    expect(installId).toBeDefined();
    if (installId !== undefined) {
      expect(fake.installs.get(installId)?.state).toBe("revoked");
    }
  });

  it("CON-12: after opt-out the next opt-in registers a different install", async () => {
    const { root, fake } = installCollectionHarness();
    await optInAnonymous(root);
    const firstId = [...fake.installs.keys()][0];
    expect(firstId).toBeDefined();
    await canon(["collection:opt-out", "--confirm"], { cwd: root });
    await optInAnonymous(root);
    const ids = [...fake.installs.keys()];
    expect(ids.length).toBe(2);
    const secondId = ids.find((id) => id !== firstId);
    expect(secondId).toBeDefined();
    if (firstId !== undefined) {
      expect(fake.installs.get(firstId)?.state).toBe("revoked");
    }
    if (secondId !== undefined) {
      expect(fake.installs.get(secondId)?.state).toBe("active");
    }
    expect(readCollectionState(root).installId).toBe(secondId);
  });

  it("CON-13: full opt-out without credentials is local-only, no network", async () => {
    const { root, fake } = installCollectionHarness();
    writeState(root, {
      metrics: {
        decision: "active",
        scopes: ["usage"],
        consentVersion: CONSENT_VERSION,
        decidedAt: "2026-01-01T00:00:00.000Z",
        expiresAt: Date.now() + 86_400_000,
      },
      metricsMode: "anonymous",
    });
    const result = await canon(["collection:opt-out", "--confirm"], { cwd: root });
    expect(result.code).toBe(0);
    expect(result.out).toMatch(/collection: opted out \(local only\) metricsMode=disallowed/);
    expect(fake.requests).toEqual([]);
    expect((readCollectionState(root).metrics as { decision: string }).decision).toBe("revoked");
  });
});

describe("CNT contact verb", () => {
  it("CNT-1: collection:identity needs exactly one of --show|--clear|--update; --help exits 0", async () => {
    const { root } = installCollectionHarness();
    const none = await canon(["collection:identity"], { cwd: root });
    expect(none.code).toBe(2);
    expect(none.err).toMatch(/exactly one of --show \| --clear \| --update is required/);

    const both = await canon(["collection:identity", "--show", "--clear"], { cwd: root });
    expect(both.code).toBe(2);

    const help = await canon(["collection:identity", "--help"], { cwd: root });
    expect(help.code).toBe(0);
    expect(help.out).toMatch(/--show/);
  });

  it("CNT-5: update and clear --json is {code,message,mode} and never print contact values", async () => {
    const { root, fake } = installCollectionHarness();
    await optInAnonymous(root);
    // Local identity update after opt-in (baseline stores contact locally).
    const updated = await canon(
      ["collection:identity", "--update", "--email=ada@example.com", "--first-name=Ada", "--json"],
      { cwd: root },
    );
    expect(updated.code).toBe(0);
    const up = JSON.parse(updated.out) as Record<string, unknown>;
    expect(Object.keys(up).sort()).toEqual(["code", "message", "mode"]);
    expect(updated.out).not.toMatch(/ada@example\.com/);
    expect(updated.out).not.toMatch(/Ada/);

    const cleared = await canon(["collection:identity", "--clear", "--json"], { cwd: root });
    expect(cleared.code).toBe(0);
    const cl = JSON.parse(cleared.out) as Record<string, unknown>;
    expect(Object.keys(cl).sort()).toEqual(["code", "message", "mode"]);
    expect(cleared.out).not.toMatch(/ada@example\.com/);
    expect(fake.requests.some((r) => r.path.includes("/optin"))).toBe(true);
  });
});

describe("FB feedback", () => {
  it("FB-1: feedback requires --kind; --help prints guidance and exits 0", async () => {
    const { root } = installCollectionHarness();
    const missing = await canon(["feedback"], { cwd: root });
    expect(missing.code).toBe(2);
    expect(missing.err).toMatch(/--kind=bug\|feature\|feedback is required/);

    const help = await canon(["feedback", "--help"], { cwd: root });
    expect(help.code).toBe(0);
    expect(help.out).toMatch(/--kind/);
    expect(help.out).toMatch(/--details-file|--summary-file|multiline/i);
  });

  it("FB-2: file flags read verbatim; conflict and unreadable exit 2", async () => {
    const { root } = installCollectionHarness();
    const detailsPath = join(root, "details.md");
    writeFileSync(detailsPath, 'line1\nline2 "quotes"\n');

    const ok = await canon(
      [
        "feedback",
        "--kind=feature",
        "--summary=from file",
        `--details-file=${detailsPath}`,
        "--dry-run",
        "--json",
      ],
      { cwd: root },
    );
    expect(ok.code).toBe(0);
    const parsed = JSON.parse(ok.out) as { payload: { details: string } };
    expect(parsed.payload.details).toBe('line1\nline2 "quotes"\n');

    const conflict = await canon(
      [
        "feedback",
        "--kind=feature",
        "--summary=x",
        "--details=inline",
        `--details-file=${detailsPath}`,
      ],
      { cwd: root },
    );
    expect(conflict.code).toBe(2);
    expect(conflict.err).toMatch(/conflict: --details and --details-file both set/);

    const unread = await canon(
      ["feedback", "--kind=bug", "--summary=x", `--stack-file=${join(root, "missing-stack.txt")}`],
      { cwd: root },
    );
    expect(unread.code).toBe(2);
    expect(unread.err).toMatch(/cannot read --stack-file/);
  });

  it("FB-3: payload shapes for feedback, bug, feature; rating and missing text", async () => {
    const { root } = installCollectionHarness();
    const fb = await canon(
      ["feedback", "--kind=feedback", "--message= hello ", "--rating=3", "--dry-run", "--json"],
      { cwd: root },
    );
    expect(fb.code).toBe(0);
    expect(JSON.parse(fb.out).payload).toEqual({ message: "hello", rating: 3 });

    const badRating = await canon(
      ["feedback", "--kind=feedback", "--message=hi", "--rating=9", "--dry-run"],
      { cwd: root },
    );
    expect(badRating.code).toBe(2);

    const bug = await canon(
      ["feedback", "--kind=bug", "--summary=boom", "--os=test-os", "--dry-run", "--json"],
      { cwd: root },
    );
    expect(bug.code).toBe(0);
    expect(JSON.parse(bug.out).payload).toMatchObject({ summary: "boom", os: "test-os" });

    const feature = await canon(
      [
        "feedback",
        "--kind=feature",
        "--summary=idea",
        "--details=more",
        "--context=ctx",
        "--dry-run",
        "--json",
      ],
      { cwd: root },
    );
    expect(feature.code).toBe(0);
    expect(JSON.parse(feature.out).payload).toEqual({
      summary: "idea",
      details: "more",
      context: "ctx",
    });

    const missing = await canon(["feedback", "--kind=bug", "--dry-run"], { cwd: root });
    expect(missing.code).toBe(2);
  });

  it("FB-4: --dry-run exits 0 with no consent check and no network", async () => {
    const { root, fake } = installCollectionHarness();
    const result = await canon(
      ["feedback", "--kind=feedback", "--message=hi", "--dry-run", "--json"],
      { cwd: root },
    );
    expect(result.code).toBe(0);
    const body = JSON.parse(result.out) as { dry_run: boolean; code: number };
    expect(body.dry_run).toBe(true);
    expect(body.code).toBe(0);
    expect(fake.requests).toEqual([]);
  });

  it("FB-5: real submit requires --disclosure-accepted even when submissions granted", async () => {
    const { root, fake } = installCollectionHarness();
    writeState(root, {
      ...activeMetrics({
        submissions: {
          granted: true,
          scopes: ["bug", "feedback", "feature"],
          consentVersion: CONSENT_VERSION,
          decidedAt: "2026-01-01T00:00:00.000Z",
          expiresAt: Date.now() + 86_400_000,
        },
      }),
    });
    const result = await canon(["feedback", "--kind=feedback", "--message=hi", "--json"], {
      cwd: root,
    });
    expect(result.code).toBe(1);
    const body = JSON.parse(result.out) as {
      disclosure_required: boolean;
      message: string;
    };
    expect(body.disclosure_required).toBe(true);
    expect(body.message).toMatch(/^feedback: user confirm required/);
    expect(body.message.toLowerCase()).not.toContain("ceremony");
    expect(fake.requests).toEqual([]);
  });

  it("FB-7: disclosure-accepted grants submissions without changing metrics; works when declined", async () => {
    const { root, fake } = installCollectionHarness();
    writeState(root, {
      metrics: {
        decision: "declined",
        scopes: [],
        consentVersion: CONSENT_VERSION,
        decidedAt: "2026-01-01T00:00:00.000Z",
      },
      metricsMode: "disallowed",
    });
    const result = await canon(
      ["feedback", "--kind=bug", "--summary=crash", "--disclosure-accepted", "--json"],
      { cwd: root },
    );
    expect(result.code).toBe(0);
    const state = readCollectionState(root);
    expect((state.metrics as { decision: string }).decision).toBe("declined");
    // D4/STO-3: presence of submissions means granted (no `granted` boolean in the new shape).
    expect(state.submissions).toBeDefined();
    const optins = fake.requests.filter((r) => r.path.includes("/optin"));
    expect(optins.length).toBe(1);
    const body = optins[0]?.body as { scopes: string[]; contact?: unknown };
    expect(body.scopes).toEqual(["feedback", "bug", "feature"]);
    expect(body).not.toHaveProperty("contact");
    expect(submissionPayloads(fake).some((s) => s.scope === "bug")).toBe(true);
  });

  it("FB-8: successful submit message; rejection; --json shape; --as-anonymous unchanged on wire", async () => {
    const { root, fake } = installCollectionHarness();
    writeState(root, {
      ...activeMetrics({
        submissions: {
          granted: true,
          scopes: ["bug", "feedback", "feature"],
          consentVersion: CONSENT_VERSION,
          decidedAt: "2026-01-01T00:00:00.000Z",
          expiresAt: Date.now() + 86_400_000,
        },
      }),
    });
    // Seed credentials are unknown to fake — need real register via disclosure path.
    writeState(root, {
      metrics: {
        decision: "active",
        scopes: ["usage"],
        consentVersion: CONSENT_VERSION,
        decidedAt: "2026-01-01T00:00:00.000Z",
        expiresAt: Date.now() + 86_400_000,
      },
      metricsMode: "anonymous",
      submissions: {
        granted: true,
        scopes: ["bug", "feedback", "feature"],
        consentVersion: CONSENT_VERSION,
        decidedAt: "2026-01-01T00:00:00.000Z",
        expiresAt: Date.now() + 86_400_000,
      },
    });
    // Re-opt-in to get real credentials on the fake, then grant submissions.
    await optInAnonymous(root);
    // After opt-in, submissions may be absent; submit with disclosure to grant+send.
    const ok = await canon(
      [
        "feedback",
        "--kind=feedback",
        "--message=thanks",
        "--disclosure-accepted",
        "--as-anonymous",
        "--json",
      ],
      { cwd: root },
    );
    expect(ok.code).toBe(0);
    const body = JSON.parse(ok.out) as Record<string, unknown>;
    for (const key of [
      "code",
      "disclosure_required",
      "dry_run",
      "id",
      "message",
      "payload",
      "scope",
    ]) {
      expect(body).toHaveProperty(key);
    }
    expect(String(body.message)).toMatch(/feedback: submitted feedback id=/);
    expect(String(body.message)).toMatch(/\(as-anonymous\)/);

    const payloads = submissionPayloads(fake).filter((s) => s.scope === "feedback");
    expect(payloads.length).toBeGreaterThanOrEqual(1);
    expect(payloads[0]?.payload).toEqual({ message: "thanks" });

    fake.failNext("challenge", "denied");
    const rejected = await canon(
      ["feedback", "--kind=feedback", "--message=again", "--disclosure-accepted"],
      { cwd: root },
    );
    expect(rejected.code).toBe(1);
    expect(rejected.err).toMatch(/feedback: submit rejected -- denied/);
  });
});

describe("PRIV / ARC", () => {
  it("PRIV-1: no usage/bug/feature/feedback payload contains contact keys", async () => {
    const { root, fake } = installCollectionHarness();
    await optInAnonymous(root);
    await canon(
      ["collection:identity", "--update", "--email=ada@example.com", "--first-name=Ada"],
      { cwd: root },
    );
    await canon(["collection:metric", "--metric=orient_ok", "--value=1"], { cwd: root });
    await canon(["feedback", "--kind=bug", "--summary=boom", "--disclosure-accepted"], {
      cwd: root,
    });
    await canon(["feedback", "--kind=feature", "--summary=idea", "--disclosure-accepted"], {
      cwd: root,
    });
    await canon(["feedback", "--kind=feedback", "--message=hi", "--disclosure-accepted"], {
      cwd: root,
    });

    // Assert on the wire (fake.requests): B7 schema rejection would hide leaks from
    // install.submissions, so a PRIV-1 mutation that adds contact keys must fail here.
    const submissionReqs = fake.requests.filter((r) => r.path.startsWith("/v1/submissions/"));
    expect(submissionReqs.length).toBeGreaterThan(0);
    for (const req of submissionReqs) {
      const body = req.body as { payload?: Record<string, unknown> } | undefined;
      const payload = body?.payload ?? {};
      for (const key of CONTACT_KEYS) {
        expect(payload).not.toHaveProperty(key);
      }
      const blob = JSON.stringify(payload);
      expect(blob).not.toMatch(/ada@example\.com/i);
      expect(blob).not.toMatch(/"Ada"/);
    }
  });

  it("ARC-8: harness stubs HOME; fake throws on foreign hosts; real home untouched", async () => {
    const { root, home, fake } = installCollectionHarness();
    await optInAnonymous(root);
    // D3: correlator / ~/.config/canonical/identity.json removed — HOME stub still
    // isolates any residual writes; STO-2 asserts the project-only boundary.
    expect(home).not.toBe("");
    expect(existsSync(home)).toBe(true);
    await expect(
      fake.fetch("https://evil.example/collector/v1/registrations" as unknown as RequestInfo),
    ).rejects.toThrow(/refused URL outside baked collector base/);
    // Requests only hit baked base.
    for (const req of fake.requests) {
      expect(req.path.startsWith("/v1/")).toBe(true);
    }
    expect(COLLECTION_BASE_URL).toMatch(/^https:\/\//);
    expect(root.startsWith(home) || existsSync(join(root, ".canonical"))).toBe(true);
  });
});

describe("MET metrics", () => {
  it("MET-1: no usage event unless metrics are active (even with submissions granted)", async () => {
    const { root, fake } = installCollectionHarness();
    writeState(root, {
      metrics: {
        decision: "declined",
        scopes: [],
        consentVersion: CONSENT_VERSION,
        decidedAt: "2026-01-01T00:00:00.000Z",
      },
      metricsMode: "disallowed",
      submissions: {
        granted: true,
        scopes: ["bug", "feedback", "feature"],
        consentVersion: CONSENT_VERSION,
        decidedAt: "2026-01-01T00:00:00.000Z",
        expiresAt: Date.now() + 86_400_000,
      },
    });
    const result = await canon(["collection:metric", "--metric=orient_ok", "--value=1"], {
      cwd: root,
    });
    expect(result.code).toBe(0);
    expect(result.out).toMatch(/collection:metric skipped \(no_consent\)/);
    expect(usagePayloads(fake)).toEqual([]);
    expect(fake.requests).toEqual([]);
  });

  it("MET-2: usage payload shape on scope usage; oversized dimensions refuse client-side", async () => {
    const { root, fake } = installCollectionHarness();
    await optInAnonymous(root);
    const ok = await canon(
      [
        "collection:metric",
        "--metric=orient_ok",
        "--value=1",
        '--dimensions={"stack_family":"node"}',
      ],
      { cwd: root },
    );
    expect(ok.code).toBe(0);
    expect(ok.out).toMatch(/collection:metric emitted id=/);
    const usages = usagePayloads(fake);
    expect(usages.length).toBe(1);
    expect(usages[0]).toMatchObject({
      metric: "orient_ok",
      value: 1,
      dimensions: { stack_family: "node" },
    });

    const big: Record<string, string> = {};
    for (let i = 0; i < 40; i += 1) {
      big[`k${i}`] = "x".repeat(80);
    }
    const before = fake.requests.length;
    const refused = await canon(
      [
        "collection:metric",
        "--metric=orient_ok",
        "--value=1",
        `--dimensions=${JSON.stringify(big)}`,
      ],
      { cwd: root },
    );
    expect(refused.code).toBe(2);
    expect(fake.requests.length).toBe(before);
  });

  it("MET-3: collection:metric arg validation and soft outcomes", async () => {
    const { root } = installCollectionHarness();
    expect((await canon(["collection:metric", "--value=1"], { cwd: root })).code).toBe(2);
    expect(
      (await canon(["collection:metric", "--metric= ", "--value=1"], { cwd: root })).code,
    ).toBe(2);
    expect(
      (await canon(["collection:metric", "--metric=x", "--value=nope"], { cwd: root })).code,
    ).toBe(2);
    expect(
      (
        await canon(["collection:metric", "--metric=x", "--value=1", "--dimensions=[1]"], {
          cwd: root,
        })
      ).code,
    ).toBe(2);

    await optInAnonymous(root);
    const json = await canon(["collection:metric", "--metric=orient_ok", "--value=1", "--json"], {
      cwd: root,
    });
    expect(json.code).toBe(0);
    expect(JSON.parse(json.out).code).toBe(0);
  });

  it("MET-4: agent_turn never touches the network; increments session when active", async () => {
    const { root, fake } = installCollectionHarness();
    await optInAnonymous(root);
    const before = fake.requests.length;
    const result = await canon(
      ["collection:metric", "--metric=agent_turn", "--value=1", "--json"],
      { cwd: root },
    );
    expect(result.code).toBe(0);
    expect(JSON.parse(result.out)).toEqual({ code: 0, recorded: true });
    expect(fake.requests.length).toBe(before);
    const sessionPath = join(root, ".canonical", "collection-session.json");
    expect(existsSync(sessionPath)).toBe(true);
    const session = JSON.parse(readFileSync(sessionPath, "utf8")) as { agentTurns: number };
    expect(session.agentTurns).toBe(1);
  });

  it("MET-5: no session file while metrics are not active", async () => {
    const { root } = installCollectionHarness();
    const result = await canon(["collection:metric", "--metric=agent_turn", "--value=1"], {
      cwd: root,
    });
    expect(result.code).toBe(0);
    expect(existsSync(join(root, ".canonical", "collection-session.json"))).toBe(false);
  });

  it("MET-6: session_summary fills buckets from session and deletes file after success", async () => {
    const { root, fake } = installCollectionHarness();
    await optInAnonymous(root);
    for (let i = 0; i < 3; i += 1) {
      await canon(["collection:metric", "--metric=agent_turn", "--value=1"], { cwd: root });
    }
    await canon(["scope:new", "Session summary scope"], { cwd: root });

    const result = await canon(["collection:metric", "--metric=session_summary", "--value=1"], {
      cwd: root,
    });
    expect(result.code).toBe(0);
    expect(result.out).toMatch(/emitted id=/);
    expect(existsSync(join(root, ".canonical", "collection-session.json"))).toBe(false);

    const summary = usagePayloads(fake).find((p) => p.metric === "session_summary");
    expect(summary).toBeDefined();
    const dims = summary?.dimensions as Record<string, unknown>;
    expect(dims.agent_turns_bucket).toBe("1-5");
    expect(dims.scopes_created).toBeGreaterThanOrEqual(1);
    expect(dims).toHaveProperty("scopes_completed");
    expect(dims).toHaveProperty("scopes_cancelled");
    expect(dims).toHaveProperty("checks_run");
    expect(dims).toHaveProperty("duration_bucket");
  });

  it("MET-7: session_summary no longer sends consent_prompts", async () => {
    const { root, fake } = installCollectionHarness();
    await optInAnonymous(root);
    await canon(["collection:metric", "--metric=agent_turn", "--value=1"], { cwd: root });
    await canon(["scope:new", "MET-7 scope"], { cwd: root });

    const result = await canon(["collection:metric", "--metric=session_summary", "--value=1"], {
      cwd: root,
    });
    expect(result.code).toBe(0);
    const summary = usagePayloads(fake).find((p) => p.metric === "session_summary");
    expect(summary).toBeDefined();
    const dims = summary?.dimensions as Record<string, unknown>;
    expect(dims).not.toHaveProperty("consent_prompts");
  });

  it("MET-8: xbrief_inventory at most once per 24h; throttle advances only after success", async () => {
    const { root, fake } = installCollectionHarness();
    await optInAnonymous(root);
    const first = await canon(["orient", "--allow-dirty"], { cwd: root });
    expect(first.code).toBe(0);
    const inventoryPath = join(root, ".canonical", "collection-inventory.json");
    expect(existsSync(inventoryPath)).toBe(true);
    const firstAt = (
      JSON.parse(readFileSync(inventoryPath, "utf8")) as { lastInventoryEmittedAt: number }
    ).lastInventoryEmittedAt;

    const inventoryBefore = usagePayloads(fake).filter((p) => p.metric === "xbrief_inventory");
    expect(inventoryBefore.length).toBe(1);
    expect(inventoryBefore[0]?.dimensions).toMatchObject({
      proposed: expect.any(Number),
      pending: expect.any(Number),
      active: expect.any(Number),
      completed: expect.any(Number),
      cancelled: expect.any(Number),
      deferred: expect.any(Number),
      blocked: expect.any(Number),
    });

    const second = await canon(["orient", "--allow-dirty"], { cwd: root });
    expect(second.code).toBe(0);
    const inventoryAfter = usagePayloads(fake).filter((p) => p.metric === "xbrief_inventory");
    expect(inventoryAfter.length).toBe(1);
    const secondAt = (
      JSON.parse(readFileSync(inventoryPath, "utf8")) as { lastInventoryEmittedAt: number }
    ).lastInventoryEmittedAt;
    expect(secondAt).toBe(firstAt);
  });

  it("MET-8: inventory throttle does not advance when emit fails", async () => {
    const { root, fake } = installCollectionHarness();
    await optInAnonymous(root);
    const inventoryPath = join(root, ".canonical", "collection-inventory.json");
    expect(existsSync(inventoryPath)).toBe(false);

    // Fail both orient_ok and xbrief_inventory challenge probes.
    fake.failNext("challenge", "denied");
    fake.failNext("challenge", "denied");
    const orient = await canon(["orient", "--allow-dirty"], { cwd: root });
    expect(orient.code).toBe(0);
    expect(existsSync(inventoryPath)).toBe(false);
    expect(usagePayloads(fake).filter((p) => p.metric === "xbrief_inventory")).toEqual([]);
  });

  it("MET-8: inventory throttle survives session_summary clear", async () => {
    const { root, fake } = installCollectionHarness();
    await optInAnonymous(root);
    await canon(["orient", "--allow-dirty"], { cwd: root });
    const inventoryPath = join(root, ".canonical", "collection-inventory.json");
    expect(existsSync(inventoryPath)).toBe(true);
    const firstAt = (
      JSON.parse(readFileSync(inventoryPath, "utf8")) as { lastInventoryEmittedAt: number }
    ).lastInventoryEmittedAt;

    await canon(["collection:metric", "--metric=agent_turn", "--value=1"], { cwd: root });
    await canon(["collection:metric", "--metric=session_summary", "--value=1"], { cwd: root });
    expect(existsSync(join(root, ".canonical", "collection-session.json"))).toBe(false);
    expect(existsSync(inventoryPath)).toBe(true);
    expect(
      (JSON.parse(readFileSync(inventoryPath, "utf8")) as { lastInventoryEmittedAt: number })
        .lastInventoryEmittedAt,
    ).toBe(firstAt);

    const before = usagePayloads(fake).filter((p) => p.metric === "xbrief_inventory").length;
    await canon(["orient", "--allow-dirty"], { cwd: root });
    expect(usagePayloads(fake).filter((p) => p.metric === "xbrief_inventory").length).toBe(before);
  });

  it("MET-9: orient, scope:new, triage, scope:start/stop/defer/complete emit documented metrics", async () => {
    const { root, fake } = installCollectionHarness();
    await optInAnonymous(root);

    await canon(["orient", "--allow-dirty"], { cwd: root });
    expect(usagePayloads(fake).some((p) => p.metric === "orient_ok")).toBe(true);

    const created = await canon(["scope:new", "MET nine story"], { cwd: root });
    expect(created.code).toBe(0);
    const createdMetric = usagePayloads(fake).find((p) => p.metric === "xbrief_scope_created");
    expect(createdMetric?.dimensions).toMatchObject({
      kind: expect.any(String),
      has_acceptance_count: expect.any(Number),
      dependency_count: expect.any(Number),
    });

    const rel = writeScopeFixture(root, "proposed", "2026-01-02-triage-me.json", {
      title: "Triage me",
      status: "proposed",
    });
    const triage = await canon(["triage", "accept", rel], { cwd: root });
    expect(triage.code).toBe(0);
    const triageMetric = usagePayloads(fake).find((p) => p.metric === "xbrief_triage");
    expect(triageMetric?.dimensions).toMatchObject({
      decision: "accept",
      from_status: expect.any(String),
      to_status: expect.any(String),
    });

    git(root, "checkout", "-q", "-b", "feature/met9");
    const startRel = writeScopeFixture(root, "proposed", "2026-01-02-start-me.json", {
      title: "Start me",
      status: "proposed",
    });
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "start fixture");
    const started = await canon(["scope:start", startRel], { cwd: root });
    expect(started.code).toBe(0);
    const startMetric = usagePayloads(fake).find((p) => p.metric === "xbrief_scope_start");
    expect(startMetric?.dimensions).toMatchObject({
      kind: expect.any(String),
      acceptance_pending_count: expect.any(Number),
    });

    const completeRel = writeScopeFixture(root, "active", "2026-01-02-complete-me.json", {
      title: "Complete me",
      status: "running",
      created: "2026-01-01T00:00:00.000Z",
      "x-canonical/kind": "epic",
      items: [{ id: "ac1", title: "done", status: "completed" }],
      "x-canonical/dependencies": ["dep"],
    });
    const completed = await canon(
      [
        "scope:complete",
        completeRel,
        "--disposition=delivered",
        "--pr=https://github.com/org/repo/pull/1",
      ],
      { cwd: root },
    );
    expect(completed.code).toBe(0);
    const completeMetric = usagePayloads(fake).find((p) => p.metric === "scope_complete");
    expect(completeMetric?.dimensions).toMatchObject({
      kind: "epic",
      acceptance_total: 1,
      acceptance_completed: 1,
      dependency_count: 1,
      disposition: "delivered",
      had_delivery_pr: true,
      lifetime_hours: expect.any(String),
    });

    const noPrRel = writeScopeFixture(root, "active", "2026-01-02-complete-nopr.json", {
      title: "Complete no pr",
      status: "running",
      "x-canonical/kind": "epic",
    });
    const completedNoPr = await canon(["scope:complete", noPrRel], { cwd: root });
    expect(completedNoPr.code).toBe(0);
    const noPrMetric = usagePayloads(fake)
      .filter((p) => p.metric === "scope_complete")
      .at(-1);
    expect(noPrMetric?.dimensions).not.toHaveProperty("had_delivery_pr");

    const stopRel = writeScopeFixture(root, "pending", "2026-01-02-stop-me.json", {
      title: "Stop me",
      status: "pending",
    });
    const stop = await canon(["scope:stop", stopRel, "--cancel"], { cwd: root });
    expect(stop.code).toBe(0);
    expect(
      usagePayloads(fake).some(
        (p) =>
          p.metric === "xbrief_scope_stop" &&
          (p.dimensions as { action?: string }).action === "cancel",
      ),
    ).toBe(true);

    const deferRel = writeScopeFixture(root, "pending", "2026-01-02-defer-me.json", {
      title: "Defer me",
      status: "pending",
    });
    const defer = await canon(["scope:defer", deferRel], { cwd: root });
    expect(defer.code).toBe(0);
    expect(
      usagePayloads(fake).some(
        (p) =>
          p.metric === "xbrief_scope_stop" &&
          (p.dimensions as { action?: string }).action === "defer",
      ),
    ).toBe(true);
  });

  it("MET-9: check exit 0/1 emits check_pass / check_fail with failed_stage", async () => {
    const { root, fake } = installCollectionHarness();
    await optInAnonymous(root);

    writeFileSync(
      join(root, "xbrief", "PROJECT.xbrief.json"),
      `${JSON.stringify(
        {
          xBRIEFInfo: { version: "0.8" },
          plan: {
            title: "test-project",
            status: "running",
            items: [],
            "x-canonical/policy": {},
            "x-canonical/quality": { commands: ["true"] },
          },
        },
        null,
        2,
      )}\n`,
    );
    mkdirSync(join(root, "coverage"), { recursive: true });
    const coveragePath = join(root, "coverage", "coverage-summary.json");
    writeFileSync(
      coveragePath,
      `${JSON.stringify({ total: { lines: { pct: 88 }, branches: { pct: 80 } } })}\n`,
    );
    // Artifact must look like it was produced during this check (mtime >= check start).
    const fresh = (Date.now() + 60_000) / 1000;
    utimesSync(coveragePath, fresh, fresh);

    const checkPass = await canon(["check"], { cwd: root });
    expect(checkPass.code).toBe(0);
    const passMetric = usagePayloads(fake).find((p) => p.metric === "check_pass");
    expect(passMetric?.dimensions).toMatchObject({
      coverage_lines_pct: 88,
      coverage_branches_pct: 80,
    });

    mkdirSync(join(root, "xbrief", "active"), { recursive: true });
    writeFileSync(join(root, "xbrief", "active", "not-a-valid-name.json"), "{}\n");
    const checkFail = await canon(["check"], { cwd: root });
    expect(checkFail.code).toBe(1);
    const failMetric = usagePayloads(fake).find((p) => p.metric === "check_fail");
    expect(failMetric).toBeDefined();
    expect((failMetric?.dimensions as { failed_stage?: string } | undefined)?.failed_stage).toBe(
      "state:validate",
    );
  });

  it("MET-10: telemetry never changes host exit code and never throws", async () => {
    const { root, fake } = installCollectionHarness();
    await optInAnonymous(root);

    fake.failNext("challenge", "internal_error");
    const orient = await canon(["orient", "--allow-dirty"], { cwd: root });
    expect(orient.code).toBe(0);

    fake.failNext("challenge", "denied");
    const metric = await canon(["collection:metric", "--metric=orient_ok", "--value=1"], {
      cwd: root,
    });
    expect(metric.code).toBe(0);
    expect(metric.out).toMatch(/skipped|emitted/);
  });

  it("MET-11: every request carries x-deft-deployment and matching body deployment_id", async () => {
    const { root, fake } = installCollectionHarness();
    await optInAnonymous(root);
    await canon(["collection:metric", "--metric=orient_ok", "--value=1"], { cwd: root });

    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
      version: string;
    };
    const expected = `canonical:cli:${COLLECTION_ENV}:${pkg.version}`;
    expect(fake.requests.length).toBeGreaterThan(0);
    for (const req of fake.requests) {
      expect(req.headers["x-deft-deployment"]).toBe(expected);
      if (req.body !== undefined && req.body !== null && typeof req.body === "object") {
        expect((req.body as { deployment_id?: string }).deployment_id).toBe(expected);
      }
    }
    // Baked host cannot be overridden by env.
    vi.stubEnv("COLLECTION_BASE_URL", "https://evil.example");
    const before = fake.requests.length;
    await canon(["collection:metric", "--metric=orient_ok", "--value=1"], { cwd: root });
    expect(fake.requests.length).toBeGreaterThan(before);
  });
});
