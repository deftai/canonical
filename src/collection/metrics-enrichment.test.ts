import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  acceptanceItem,
  cleanupTempDirs,
  tempGitRepo,
  writeScopeFixture,
} from "../test-support/index.js";
import { writeCollectionFile } from "./storage.js";
import { CONSENT_VERSION } from "./types.js";

const emitUsageMock = vi.hoisted(() => vi.fn());

vi.mock("./emit.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("./emit.js")>();
  return { ...mod, emitUsage: emitUsageMock };
});

afterAll(() => cleanupTempDirs());

function optInRoot(): string {
  const root = tempGitRepo();
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
  return root;
}

describe("metrics enrichment golden payloads (#9)", () => {
  let outSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    emitUsageMock.mockReset();
    emitUsageMock.mockResolvedValue({ emitted: true, id: "evt-1" });
    outSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    outSpy.mockRestore();
    errSpy.mockRestore();
  });

  it("scope_complete with delivery includes enriched dimensions", async () => {
    const { run: runScopeComplete } = await import("../cli/scope-complete.js");
    const root = optInRoot();
    writeScopeFixture(root, "active", "2026-01-01-foo.xbrief.json", {
      status: "running",
      created: "2026-01-01T00:00:00.000Z",
      items: [acceptanceItem("a1", "x", true), acceptanceItem("a2", "y", false)],
      "x-canonical/dependencies": ["dep"],
    });

    const code = await runScopeComplete([
      "2026-01-01-foo.xbrief.json",
      "--project-root",
      root,
      "--disposition",
      "delivered",
      "--pr",
      "https://github.com/org/repo/pull/1",
    ]);
    expect(code).toBe(0);
    const completeCall = emitUsageMock.mock.calls.find((c) => c[1] === "scope_complete");
    expect(completeCall?.[3]?.dimensions).toMatchObject({
      kind: "story",
      disposition: "delivered",
      had_delivery_pr: true,
      acceptance_total: 2,
      acceptance_completed: 1,
      dependency_count: 1,
    });
    expect(completeCall?.[3]?.dimensions?.lifetime_hours).toBeDefined();
  });

  it("scope_complete without delivery omits had_delivery_pr", async () => {
    const { run: runScopeComplete } = await import("../cli/scope-complete.js");
    const root = optInRoot();
    writeScopeFixture(root, "active", "2026-01-01-epic.xbrief.json", {
      "x-canonical/kind": "epic",
      status: "running",
    });

    const code = await runScopeComplete(["2026-01-01-epic.xbrief.json", "--project-root", root]);
    expect(code).toBe(0);
    const call = emitUsageMock.mock.calls.find((c) => c[1] === "scope_complete");
    expect(call?.[3]?.dimensions).not.toHaveProperty("had_delivery_pr");
  });

  it("check_pass includes coverage dimensions when summary exists", async () => {
    const { mkdirSync, writeFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { run: runCheck } = await import("../cli/check.js");
    const root = optInRoot();
    mkdirSync(join(root, "coverage"), { recursive: true });
    writeFileSync(
      join(root, "coverage", "coverage-summary.json"),
      `${JSON.stringify({ total: { lines: { pct: 88 }, branches: { pct: 80 } } })}\n`,
    );
    writeFileSync(
      join(root, "xbrief", "PROJECT.xbrief.json"),
      `${JSON.stringify({
        xBRIEFInfo: { version: "0.8" },
        plan: {
          title: "t",
          status: "running",
          items: [],
          "x-canonical/policy": {},
          "x-canonical/quality": { commands: ["true"] },
        },
      })}\n`,
    );

    const code = await runCheck(["--project-root", root]);
    expect(code).toBe(0);
    expect(emitUsageMock).toHaveBeenCalledWith(
      root,
      "check_pass",
      1,
      expect.objectContaining({
        dimensions: {
          coverage_lines_pct: 88,
          coverage_branches_pct: 80,
        },
      }),
    );
  });

  it("skips submit when usage declined", async () => {
    const { run: runScopeComplete } = await import("../cli/scope-complete.js");
    const root = tempGitRepo();
    writeScopeFixture(root, "active", "2026-01-01-epic.xbrief.json", {
      "x-canonical/kind": "epic",
      status: "running",
    });
    emitUsageMock.mockResolvedValue({ emitted: false, reason: "no_consent" });

    await runScopeComplete(["2026-01-01-epic.xbrief.json", "--project-root", root]);
    expect(emitUsageMock).toHaveBeenCalled();
    await expect(emitUsageMock.mock.results[0]?.value).resolves.toEqual({
      emitted: false,
      reason: "no_consent",
    });
  });
});
