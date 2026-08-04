import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cleanupTempDirs, tempGitRepo, writeScopeFixture } from "../test-support/index.js";
import { validateState } from "./validate.js";

afterAll(() => {
  cleanupTempDirs();
});

function findingCodes(report: ReturnType<typeof validateState>): string[] {
  return report.findings.map((f) => f.code);
}

describe("validateState", () => {
  it("is ok on an empty briefs/ tree", () => {
    const root = tempGitRepo();
    const report = validateState(root);
    expect(report.ok).toBe(true);
    expect(report.scanned).toBe(0);
    expect(report.findings).toEqual([]);
  });

  it("is ok for a well-formed scope in the correct folder", () => {
    const root = tempGitRepo();
    writeScopeFixture(root, "proposed", "2026-01-01-happy-path.json");
    const report = validateState(root);
    expect(report.ok).toBe(true);
    expect(report.scanned).toBe(1);
  });

  it("flags a filename that does not match the YYYY-MM-DD-<slug>.json pattern", () => {
    const root = tempGitRepo();
    writeScopeFixture(root, "proposed", "not-a-valid-filename.json");
    const report = validateState(root);
    expect(report.ok).toBe(false);
    expect(findingCodes(report)).toContain("bad-filename");
  });

  it("flags a slug with uppercase or underscore characters", () => {
    const root = tempGitRepo();
    writeScopeFixture(root, "proposed", "2026-01-01-Bad_Slug.json");
    const report = validateState(root);
    expect(findingCodes(report)).toContain("bad-filename");
  });

  it("flags folder/status disagreement", () => {
    const root = tempGitRepo();
    // default fixture status is "proposed", filed under active/ (expects running|blocked).
    writeScopeFixture(root, "active", "2026-01-01-mismatch.json");
    const report = validateState(root);
    expect(report.ok).toBe(false);
    expect(findingCodes(report)).toContain("folder-status-mismatch");
  });

  it("accepts every legal folder/status pairing", () => {
    const root = tempGitRepo();
    writeScopeFixture(root, "proposed", "2026-01-01-a.json", {
      plan: {
        status: "proposed",
        created: "2026-01-01T00:00:00.000Z",
        updated: "2026-01-01T00:00:00.000Z",
      },
    });
    writeScopeFixture(root, "pending", "2026-01-01-b.json", {
      plan: {
        status: "pending",
        created: "2026-01-01T00:00:00.000Z",
        updated: "2026-01-01T00:00:00.000Z",
      },
    });
    writeScopeFixture(root, "active", "2026-01-01-c.json", {
      plan: {
        status: "running",
        created: "2026-01-01T00:00:00.000Z",
        updated: "2026-01-01T00:00:00.000Z",
      },
    });
    writeScopeFixture(root, "active", "2026-01-01-d.json", {
      plan: {
        status: "blocked",
        created: "2026-01-01T00:00:00.000Z",
        updated: "2026-01-01T00:00:00.000Z",
      },
    });
    writeScopeFixture(root, "completed", "2026-01-01-e.json", {
      plan: {
        status: "completed",
        created: "2026-01-01T00:00:00.000Z",
        updated: "2026-01-01T00:00:00.000Z",
      },
    });
    writeScopeFixture(root, "completed", "2026-01-01-f.json", {
      plan: {
        status: "failed",
        created: "2026-01-01T00:00:00.000Z",
        updated: "2026-01-01T00:00:00.000Z",
      },
    });
    writeScopeFixture(root, "cancelled", "2026-01-01-g.json", {
      plan: {
        status: "cancelled",
        created: "2026-01-01T00:00:00.000Z",
        updated: "2026-01-01T00:00:00.000Z",
      },
    });
    const report = validateState(root);
    expect(report.ok).toBe(true);
    expect(report.scanned).toBe(7);
  });

  it("flags a missing/non-string title", () => {
    const root = tempGitRepo();
    writeScopeFixture(root, "proposed", "2026-01-01-no-title.json", { title: 42 });
    const report = validateState(root);
    expect(findingCodes(report)).toContain("bad-title");
  });

  it("flags a kind outside story|epic|chore", () => {
    const root = tempGitRepo();
    writeScopeFixture(root, "proposed", "2026-01-01-bad-kind.json", { kind: "task" });
    const report = validateState(root);
    expect(findingCodes(report)).toContain("bad-kind");
  });

  it("flags a missing plan object", () => {
    const root = tempGitRepo();
    writeScopeFixture(root, "proposed", "2026-01-01-no-plan.json", { plan: undefined });
    const report = validateState(root);
    expect(findingCodes(report)).toContain("missing-plan");
  });

  it("flags a status outside the seven-value enum", () => {
    const root = tempGitRepo();
    writeScopeFixture(root, "proposed", "2026-01-01-bad-status.json", {
      plan: {
        status: "in-progress",
        created: "2026-01-01T00:00:00.000Z",
        updated: "2026-01-01T00:00:00.000Z",
      },
    });
    const report = validateState(root);
    expect(findingCodes(report)).toContain("bad-plan-status");
  });

  it("flags non-ISO plan.created / plan.updated", () => {
    const root = tempGitRepo();
    writeScopeFixture(root, "proposed", "2026-01-01-bad-dates.json", {
      plan: { status: "proposed", created: "not-a-date", updated: "also-not-a-date" },
    });
    const report = validateState(root);
    const codes = findingCodes(report);
    expect(codes).toContain("bad-plan-created");
    expect(codes).toContain("bad-plan-updated");
  });

  it("flags a reference missing uri/type/trust", () => {
    const root = tempGitRepo();
    writeScopeFixture(root, "proposed", "2026-01-01-bad-ref.json", {
      references: [{ uri: "", type: "not-a-type", trust: "not-a-trust" }],
    });
    const report = validateState(root);
    const codes = findingCodes(report);
    expect(codes.filter((c) => c === "bad-reference").length).toBe(3);
  });

  it("flags an issue-type reference with no narratives.Origin", () => {
    const root = tempGitRepo();
    writeScopeFixture(root, "proposed", "2026-01-01-no-origin.json", {
      references: [{ uri: "https://github.com/x/y/issues/1", type: "issue", trust: "external" }],
      narratives: { Description: "test" },
    });
    const report = validateState(root);
    expect(findingCodes(report)).toContain("missing-origin-narrative");
  });

  it("passes an issue-type reference that does carry narratives.Origin", () => {
    const root = tempGitRepo();
    writeScopeFixture(root, "proposed", "2026-01-01-with-origin.json", {
      references: [{ uri: "https://github.com/x/y/issues/1", type: "issue", trust: "external" }],
      narratives: { Description: "test", Origin: "Ingested from issue #1" },
    });
    const report = validateState(root);
    expect(report.ok).toBe(true);
  });

  it("flags duplicate origin URIs across two different scopes", () => {
    const root = tempGitRepo();
    const uri = "https://github.com/x/y/issues/42";
    writeScopeFixture(root, "proposed", "2026-01-01-first.json", {
      references: [{ uri, type: "issue", trust: "external" }],
      narratives: { Description: "test", Origin: "Ingested from issue #42" },
    });
    writeScopeFixture(root, "proposed", "2026-01-02-second.json", {
      references: [{ uri, type: "issue", trust: "external" }],
      narratives: { Description: "test", Origin: "Ingested from issue #42" },
    });
    const report = validateState(root);
    expect(findingCodes(report)).toContain("duplicate-origin-uri");
    // exactly one of the two files is flagged (the second occurrence).
    expect(report.findings.filter((f) => f.code === "duplicate-origin-uri").length).toBe(1);
  });

  it("does not flag repeated origin URI within the very same scope file", () => {
    const root = tempGitRepo();
    const uri = "https://github.com/x/y/issues/7";
    writeScopeFixture(root, "proposed", "2026-01-01-self.json", {
      references: [
        { uri, type: "issue", trust: "external" },
        { uri, type: "issue", trust: "external" },
      ],
      narratives: { Description: "test", Origin: "Ingested from issue #7" },
    });
    const report = validateState(root);
    expect(findingCodes(report)).not.toContain("duplicate-origin-uri");
  });

  it("flags a malformed swarm block shape", () => {
    const root = tempGitRepo();
    writeScopeFixture(root, "proposed", "2026-01-01-bad-swarm.json", {
      swarm: { file_scope: "src/x.ts", verify_commands: 123, readiness: "sometimes" },
    });
    const report = validateState(root);
    const codes = findingCodes(report);
    expect(codes.filter((c) => c === "bad-swarm-shape").length).toBeGreaterThanOrEqual(3);
  });

  it("flags swarm readiness=ready with empty file_scope/verify_commands", () => {
    const root = tempGitRepo();
    writeScopeFixture(root, "proposed", "2026-01-01-ready-empty.json", {
      items: [
        { id: "ac1", text: "a", done: false },
        { id: "ac2", text: "b", done: false },
      ],
      swarm: { file_scope: [], verify_commands: [], readiness: "ready" },
    });
    const report = validateState(root);
    const codes = findingCodes(report);
    expect(codes).toContain("swarm-ready-empty-file-scope");
    expect(codes).toContain("swarm-ready-empty-verify-commands");
  });

  it("flags swarm readiness=ready with fewer than 2 or more than 5 acceptance items", () => {
    const root = tempGitRepo();
    writeScopeFixture(root, "proposed", "2026-01-01-ready-few-items.json", {
      items: [{ id: "ac1", text: "a", done: false }],
      swarm: { file_scope: ["src/a.ts"], verify_commands: ["task check"], readiness: "ready" },
    });
    const report = validateState(root);
    expect(findingCodes(report)).toContain("swarm-ready-acceptance-count");
  });

  it("accepts a fully-ready swarm block with 2-5 acceptance items", () => {
    const root = tempGitRepo();
    writeScopeFixture(root, "proposed", "2026-01-01-ready-ok.json", {
      items: [
        { id: "ac1", text: "a", done: false },
        { id: "ac2", text: "b", done: false },
      ],
      swarm: { file_scope: ["src/a.ts"], verify_commands: ["task check"], readiness: "ready" },
    });
    const report = validateState(root);
    expect(report.ok).toBe(true);
  });

  it("accepts swarm readiness=blocked with empty file_scope (only 'ready' is gated)", () => {
    const root = tempGitRepo();
    writeScopeFixture(root, "proposed", "2026-01-01-blocked-swarm.json", {
      swarm: { file_scope: [], verify_commands: [], readiness: "blocked" },
    });
    const report = validateState(root);
    expect(report.ok).toBe(true);
  });

  it("reports invalid-json for unparsable scope files and keeps scanning others", () => {
    const root = tempGitRepo();
    writeFileSync(join(root, "briefs", "proposed", "2026-01-01-broken.json"), "{ not json");
    writeScopeFixture(root, "proposed", "2026-01-02-fine.json");
    const report = validateState(root);
    expect(report.ok).toBe(false);
    expect(report.scanned).toBe(2);
    expect(findingCodes(report)).toContain("invalid-json");
  });
});
