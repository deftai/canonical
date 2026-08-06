import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { acceptanceItem, cleanupTempDirs, tempGitRepo, writeScopeFixture } from "../test-support/index.js";
import { validateState } from "./validate.js";

afterAll(() => {
  cleanupTempDirs();
});

function findingCodes(report: ReturnType<typeof validateState>): string[] {
  return report.findings.map((f) => f.code);
}

const NOW = "2026-01-01T00:00:00.000Z";
const statusPlan = (status: string) => ({ status, created: NOW, updated: NOW });

describe("validateState", () => {
  it("is ok on a freshly scaffolded xbrief/ tree (PROJECT doc only)", () => {
    const root = tempGitRepo();
    const report = validateState(root);
    expect(report.ok).toBe(true);
    // No scopes; the scaffolded PROJECT.xbrief.json is the one scanned doc.
    expect(report.scanned).toBe(1);
    expect(report.findings).toEqual([]);
  });

  it("is ok for a well-formed scope in the correct folder", () => {
    const root = tempGitRepo();
    writeScopeFixture(root, "proposed", "2026-01-01-happy-path.xbrief.json");
    const report = validateState(root);
    expect(report.ok).toBe(true);
    expect(report.scanned).toBe(2);
  });

  it("flags a plain .json scope file as legacy", () => {
    const root = tempGitRepo();
    writeScopeFixture(root, "proposed", "2026-01-01-old-format.json");
    const report = validateState(root);
    expect(report.ok).toBe(false);
    expect(findingCodes(report)).toContain("legacy-file");
  });

  it("flags a filename that does not match the YYYY-MM-DD-<slug>.xbrief.json pattern", () => {
    const root = tempGitRepo();
    writeScopeFixture(root, "proposed", "not-a-valid-filename.xbrief.json");
    const report = validateState(root);
    expect(report.ok).toBe(false);
    expect(findingCodes(report)).toContain("bad-filename");
  });

  it("flags a slug with uppercase or underscore characters", () => {
    const root = tempGitRepo();
    writeScopeFixture(root, "proposed", "2026-01-01-Bad_Slug.xbrief.json");
    const report = validateState(root);
    expect(findingCodes(report)).toContain("bad-filename");
  });

  it("flags a missing xBRIEFInfo envelope", () => {
    const root = tempGitRepo();
    writeScopeFixture(root, "proposed", "2026-01-01-no-envelope.xbrief.json", {}, {
      xBRIEFInfo: undefined,
    });
    const report = validateState(root);
    expect(findingCodes(report)).toContain("bad-envelope");
  });

  it("flags a wrong xBRIEFInfo.version", () => {
    const root = tempGitRepo();
    writeScopeFixture(root, "proposed", "2026-01-01-old-version.xbrief.json", {}, {
      xBRIEFInfo: { version: "0.5" },
    });
    const report = validateState(root);
    expect(findingCodes(report)).toContain("bad-version");
  });

  it("flags forbidden legacy containers (todoList/playbook)", () => {
    const root = tempGitRepo();
    writeScopeFixture(root, "proposed", "2026-01-01-legacy-container.xbrief.json", {}, {
      todoList: { items: [] },
    });
    const report = validateState(root);
    expect(findingCodes(report)).toContain("bad-envelope");
  });

  it("flags stray non-extension root keys on scope documents", () => {
    const root = tempGitRepo();
    writeScopeFixture(root, "proposed", "2026-01-01-stray-key.xbrief.json", {}, {
      stray: true,
    });
    const report = validateState(root);
    expect(findingCodes(report)).toContain("bad-envelope");
  });

  it("preserves foreign x-<token>/ root keys without findings", () => {
    const root = tempGitRepo();
    writeScopeFixture(root, "proposed", "2026-01-01-foreign-ext.xbrief.json", {}, {
      "x-other/blob": { anything: true },
    });
    const report = validateState(root);
    expect(report.ok).toBe(true);
  });

  it("flags folder/status disagreement", () => {
    const root = tempGitRepo();
    // default fixture status is "proposed", filed under active/ (expects running|blocked).
    writeScopeFixture(root, "active", "2026-01-01-mismatch.xbrief.json");
    const report = validateState(root);
    expect(report.ok).toBe(false);
    expect(findingCodes(report)).toContain("folder-status-mismatch");
  });

  it("accepts every legal folder/status pairing", () => {
    const root = tempGitRepo();
    writeScopeFixture(root, "proposed", "2026-01-01-a.xbrief.json", statusPlan("proposed"));
    writeScopeFixture(root, "pending", "2026-01-01-b.xbrief.json", statusPlan("pending"));
    writeScopeFixture(root, "active", "2026-01-01-c.xbrief.json", statusPlan("running"));
    writeScopeFixture(root, "active", "2026-01-01-d.xbrief.json", statusPlan("blocked"));
    writeScopeFixture(root, "completed", "2026-01-01-e.xbrief.json", statusPlan("completed"));
    writeScopeFixture(root, "completed", "2026-01-01-f.xbrief.json", statusPlan("failed"));
    writeScopeFixture(root, "cancelled", "2026-01-01-g.xbrief.json", statusPlan("cancelled"));
    const report = validateState(root);
    expect(report.ok).toBe(true);
    expect(report.scanned).toBe(8);
  });

  it("flags a missing/non-string title", () => {
    const root = tempGitRepo();
    writeScopeFixture(root, "proposed", "2026-01-01-no-title.xbrief.json", { title: 42 });
    const report = validateState(root);
    expect(findingCodes(report)).toContain("bad-title");
  });

  it("flags a kind outside story|epic|chore", () => {
    const root = tempGitRepo();
    writeScopeFixture(root, "proposed", "2026-01-01-bad-kind.xbrief.json", {
      "x-canonical/kind": "task",
    });
    const report = validateState(root);
    expect(findingCodes(report)).toContain("bad-kind");
  });

  it("flags a missing plan object", () => {
    const root = tempGitRepo();
    writeScopeFixture(root, "proposed", "2026-01-01-no-plan.xbrief.json", {}, {
      plan: undefined,
    });
    const report = validateState(root);
    expect(findingCodes(report)).toContain("missing-plan");
  });

  it("flags a status outside the core PlanStatus enum", () => {
    const root = tempGitRepo();
    writeScopeFixture(root, "proposed", "2026-01-01-bad-status.xbrief.json", {
      status: "in-progress",
    });
    const report = validateState(root);
    expect(findingCodes(report)).toContain("bad-plan-status");
  });

  it("flags a core status the canonical profile does not use (draft)", () => {
    const root = tempGitRepo();
    writeScopeFixture(root, "proposed", "2026-01-01-draft-status.xbrief.json", {
      status: "draft",
    });
    const report = validateState(root);
    expect(findingCodes(report)).toContain("bad-plan-status");
  });

  it("flags non-ISO plan.created / plan.updated", () => {
    const root = tempGitRepo();
    writeScopeFixture(root, "proposed", "2026-01-01-bad-dates.xbrief.json", {
      created: "not-a-date",
      updated: "also-not-a-date",
    });
    const report = validateState(root);
    const codes = findingCodes(report);
    expect(codes).toContain("bad-plan-created");
    expect(codes).toContain("bad-plan-updated");
  });

  it("flags timestamps lacking an explicit Z or numeric offset", () => {
    const root = tempGitRepo();
    writeScopeFixture(root, "proposed", "2026-01-01-naive-dates.xbrief.json", {
      created: "2026-01-01T00:00:00",
      updated: "2026-01-01T00:00:00",
    });
    const report = validateState(root);
    const codes = findingCodes(report);
    expect(codes).toContain("bad-plan-created");
    expect(codes).toContain("bad-plan-updated");
  });

  it("flags acceptance items missing title/status and non-string narrative values", () => {
    const root = tempGitRepo();
    writeScopeFixture(root, "proposed", "2026-01-01-bad-items.xbrief.json", {
      items: [{ id: "ac1" }],
      narratives: { Description: 42 },
    });
    const report = validateState(root);
    const codes = findingCodes(report);
    expect(codes).toContain("bad-item");
    expect(codes).toContain("bad-narrative");
  });

  it("flags duplicate item ids and colon-bearing ids", () => {
    const root = tempGitRepo();
    writeScopeFixture(root, "proposed", "2026-01-01-bad-ids.xbrief.json", {
      items: [
        acceptanceItem("ac1", "a"),
        acceptanceItem("ac1", "b"),
        acceptanceItem("wf:oops", "c"),
      ],
    });
    const report = validateState(root);
    const codes = findingCodes(report).filter((c) => c === "bad-item");
    expect(codes.length).toBeGreaterThanOrEqual(2);
  });

  it("flags a reference with bad uri, non-namespaced type, and bad trust", () => {
    const root = tempGitRepo();
    writeScopeFixture(root, "proposed", "2026-01-01-bad-ref.xbrief.json", {
      references: [{ uri: "", type: "issue", "x-canonical/trust": "not-a-trust" }],
    });
    const report = validateState(root);
    const codes = findingCodes(report);
    expect(codes.filter((c) => c === "bad-reference").length).toBe(3);
  });

  it("flags an x-xbrief/ reference type outside the spec registry", () => {
    const root = tempGitRepo();
    writeScopeFixture(root, "proposed", "2026-01-01-bad-registry.xbrief.json", {
      references: [
        { uri: "https://example.com", type: "x-xbrief/made-up", "x-canonical/trust": "external" },
      ],
    });
    const report = validateState(root);
    expect(findingCodes(report)).toContain("bad-reference");
  });

  it("flags an issue reference with no narratives.Origin", () => {
    const root = tempGitRepo();
    writeScopeFixture(root, "proposed", "2026-01-01-no-origin.xbrief.json", {
      references: [
        {
          uri: "https://github.com/x/y/issues/1",
          type: "x-xbrief/github-issue",
          "x-canonical/trust": "external",
        },
      ],
      narratives: { Description: "test" },
    });
    const report = validateState(root);
    expect(findingCodes(report)).toContain("missing-origin-narrative");
  });

  it("passes an issue reference that does carry narratives.Origin", () => {
    const root = tempGitRepo();
    writeScopeFixture(root, "proposed", "2026-01-01-with-origin.xbrief.json", {
      references: [
        {
          uri: "https://github.com/x/y/issues/1",
          type: "x-xbrief/github-issue",
          "x-canonical/trust": "external",
        },
      ],
      narratives: { Description: "test", Origin: "Ingested from issue #1" },
    });
    const report = validateState(root);
    expect(report.ok).toBe(true);
  });

  it("flags duplicate origin URIs across two different scopes", () => {
    const root = tempGitRepo();
    const uri = "https://github.com/x/y/issues/42";
    const origin = {
      references: [{ uri, type: "x-xbrief/github-issue", "x-canonical/trust": "external" }],
      narratives: { Description: "test", Origin: "Ingested from issue #42" },
    };
    writeScopeFixture(root, "proposed", "2026-01-01-first.xbrief.json", origin);
    writeScopeFixture(root, "proposed", "2026-01-02-second.xbrief.json", origin);
    const report = validateState(root);
    expect(findingCodes(report)).toContain("duplicate-origin-uri");
    // exactly one of the two files is flagged (the second occurrence).
    expect(report.findings.filter((f) => f.code === "duplicate-origin-uri").length).toBe(1);
  });

  it("does not flag repeated origin URI within the very same scope file", () => {
    const root = tempGitRepo();
    const uri = "https://github.com/x/y/issues/7";
    writeScopeFixture(root, "proposed", "2026-01-01-self.xbrief.json", {
      references: [
        { uri, type: "x-xbrief/github-issue", "x-canonical/trust": "external" },
        { uri, type: "x-xbrief/github-issue", "x-canonical/trust": "external" },
      ],
      narratives: { Description: "test", Origin: "Ingested from issue #7" },
    });
    const report = validateState(root);
    expect(findingCodes(report)).not.toContain("duplicate-origin-uri");
  });

  it("flags bad x-canonical/dependencies entries", () => {
    const root = tempGitRepo();
    writeScopeFixture(root, "proposed", "2026-01-01-bad-deps.xbrief.json", {
      "x-canonical/dependencies": ["2026-01-01-other.json"],
    });
    const report = validateState(root);
    expect(findingCodes(report)).toContain("bad-dependency");
  });

  it("flags a malformed swarm block shape", () => {
    const root = tempGitRepo();
    writeScopeFixture(root, "proposed", "2026-01-01-bad-swarm.xbrief.json", {
      "x-canonical/swarm": { filesScope: "src/x.ts", verifyCommands: 123, readiness: "sometimes" },
    });
    const report = validateState(root);
    const codes = findingCodes(report);
    expect(codes.filter((c) => c === "bad-swarm-shape").length).toBeGreaterThanOrEqual(3);
  });

  it("flags swarm readiness=ready with empty filesScope/verifyCommands", () => {
    const root = tempGitRepo();
    writeScopeFixture(root, "proposed", "2026-01-01-ready-empty.xbrief.json", {
      items: [acceptanceItem("ac1", "a"), acceptanceItem("ac2", "b")],
      "x-canonical/swarm": { filesScope: [], verifyCommands: [], readiness: "ready" },
    });
    const report = validateState(root);
    const codes = findingCodes(report);
    expect(codes).toContain("swarm-ready-empty-file-scope");
    expect(codes).toContain("swarm-ready-empty-verify-commands");
  });

  it("flags swarm readiness=ready with fewer than 2 or more than 5 acceptance items", () => {
    const root = tempGitRepo();
    writeScopeFixture(root, "proposed", "2026-01-01-ready-few-items.xbrief.json", {
      items: [acceptanceItem("ac1", "a")],
      "x-canonical/swarm": {
        filesScope: ["src/a.ts"],
        verifyCommands: ["task check"],
        readiness: "ready",
      },
    });
    const report = validateState(root);
    expect(findingCodes(report)).toContain("swarm-ready-acceptance-count");
  });

  it("accepts a fully-ready swarm block with 2-5 acceptance items", () => {
    const root = tempGitRepo();
    writeScopeFixture(root, "proposed", "2026-01-01-ready-ok.xbrief.json", {
      items: [acceptanceItem("ac1", "a"), acceptanceItem("ac2", "b")],
      "x-canonical/swarm": {
        filesScope: ["src/a.ts"],
        verifyCommands: ["task check"],
        readiness: "ready",
      },
    });
    const report = validateState(root);
    expect(report.ok).toBe(true);
  });

  it("accepts swarm readiness=blocked with empty filesScope (only 'ready' is gated)", () => {
    const root = tempGitRepo();
    writeScopeFixture(root, "proposed", "2026-01-01-blocked-swarm.xbrief.json", {
      "x-canonical/swarm": { filesScope: [], verifyCommands: [], readiness: "blocked" },
    });
    const report = validateState(root);
    expect(report.ok).toBe(true);
  });

  it("reports invalid-json for unparsable scope files and keeps scanning others", () => {
    const root = tempGitRepo();
    writeFileSync(join(root, "xbrief", "proposed", "2026-01-01-broken.xbrief.json"), "{ not json");
    writeScopeFixture(root, "proposed", "2026-01-02-fine.xbrief.json");
    const report = validateState(root);
    expect(report.ok).toBe(false);
    expect(report.scanned).toBe(3);
    expect(findingCodes(report)).toContain("invalid-json");
  });

  it("flags legacy root files (PROJECT.json etc.)", () => {
    const root = tempGitRepo();
    writeFileSync(
      join(root, "xbrief", "PROJECT.json"),
      `${JSON.stringify({ title: "old", policy: {} }, null, 2)}\n`,
    );
    const report = validateState(root);
    expect(report.ok).toBe(false);
    expect(findingCodes(report)).toContain("legacy-file");
  });

  it("validates root docs as xBRIEF documents (bad plan.xbrief.json sequence)", () => {
    const root = tempGitRepo();
    writeFileSync(
      join(root, "xbrief", "plan.xbrief.json"),
      `${JSON.stringify(
        {
          xBRIEFInfo: { version: "0.8" },
          plan: {
            title: "Delivery sequence",
            status: "running",
            items: [],
            "x-canonical/sequence": 42,
          },
        },
        null,
        2,
      )}\n`,
    );
    const report = validateState(root);
    expect(report.ok).toBe(false);
    expect(findingCodes(report)).toContain("bad-root-doc");
  });

  it("flags a root doc missing the envelope", () => {
    const root = tempGitRepo();
    writeFileSync(
      join(root, "xbrief", "spec.xbrief.json"),
      `${JSON.stringify({ plan: { title: "Spec", status: "draft", items: [] } }, null, 2)}\n`,
    );
    const report = validateState(root);
    expect(report.ok).toBe(false);
    expect(findingCodes(report)).toContain("bad-envelope");
  });
});
