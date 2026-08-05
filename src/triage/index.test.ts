import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { atomicWriteJson } from "../fs/contained-write.js";
import { cleanupTempDirs, tempGitRepo, writeScopeFixture } from "../test-support/index.js";
import { triageDecide } from "./index.js";

afterAll(() => {
  cleanupTempDirs();
});

function auditLines(root: string): unknown[] {
  const raw = readFileSync(join(root, "xbrief", "audit.jsonl"), "utf8");
  return raw
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l));
}

describe("triageDecide", () => {
  it("accept promotes proposed -> pending and appends an audit row", () => {
    const root = tempGitRepo();
    writeScopeFixture(root, "proposed", "2026-01-01-foo.json");

    const result = triageDecide(root, { verb: "accept", scope: "2026-01-01-foo.json" });

    expect(result).toMatchObject({ ok: true, verb: "accept", status: "pending" });
    expect(readFileSync(join(root, "xbrief", "pending", "2026-01-01-foo.json"), "utf8")).toContain(
      '"status": "pending"',
    );
    const rows = auditLines(root);
    expect(rows).toContainEqual(
      expect.objectContaining({
        kind: "triage",
        verb: "accept",
        scope: "xbrief/proposed/2026-01-01-foo.json",
      }),
    );
  });

  it("accept over the WIP cap without --force is a violation (exit 1)", () => {
    const root = tempGitRepo();
    atomicWriteJson(root, "xbrief/PROJECT.json", { title: "t", policy: { wipCap: 1 } });
    writeScopeFixture(root, "pending", "2026-01-01-a.json");
    writeScopeFixture(root, "proposed", "2026-01-02-b.json");

    const result = triageDecide(root, { verb: "accept", scope: "2026-01-02-b.json" });

    expect(result).toMatchObject({ ok: false, code: 1 });
  });

  it("accept over the WIP cap with --force succeeds and logs a wip-cap-override row", () => {
    const root = tempGitRepo();
    atomicWriteJson(root, "xbrief/PROJECT.json", { title: "t", policy: { wipCap: 1 } });
    writeScopeFixture(root, "pending", "2026-01-01-a.json");
    writeScopeFixture(root, "proposed", "2026-01-02-b.json");

    const result = triageDecide(root, { verb: "accept", scope: "2026-01-02-b.json", force: true });

    expect(result).toMatchObject({ ok: true, wipCapOverride: true });
    const rows = auditLines(root);
    expect(rows).toContainEqual(expect.objectContaining({ kind: "wip-cap-override" }));
    expect(rows).toContainEqual(expect.objectContaining({ kind: "triage", verb: "accept" }));
  });

  it("reject moves the scope to cancelled/", () => {
    const root = tempGitRepo();
    writeScopeFixture(root, "proposed", "2026-01-01-foo.json");

    const result = triageDecide(root, { verb: "reject", scope: "2026-01-01-foo.json" });

    expect(result).toMatchObject({ ok: true, status: "cancelled" });
    expect(() =>
      readFileSync(join(root, "xbrief", "cancelled", "2026-01-01-foo.json")),
    ).not.toThrow();
  });

  it("defer requires --note", () => {
    const root = tempGitRepo();
    writeScopeFixture(root, "proposed", "2026-01-01-foo.json");

    const result = triageDecide(root, { verb: "defer", scope: "2026-01-01-foo.json" });

    expect(result).toMatchObject({ ok: false, code: 2 });
  });

  it("defer stays in proposed/ and stamps narratives.Note, appending on repeat", () => {
    const root = tempGitRepo();
    writeScopeFixture(root, "proposed", "2026-01-01-foo.json");

    const first = triageDecide(root, {
      verb: "defer",
      scope: "2026-01-01-foo.json",
      note: "waiting on design",
    });
    expect(first).toMatchObject({ ok: true, status: "proposed" });

    const afterFirst = JSON.parse(
      readFileSync(join(root, "xbrief", "proposed", "2026-01-01-foo.json"), "utf8"),
    );
    expect(afterFirst.narratives.Note).toBe("waiting on design");

    const second = triageDecide(root, {
      verb: "defer",
      scope: "2026-01-01-foo.json",
      note: "still waiting",
    });
    expect(second.ok).toBe(true);
    const afterSecond = JSON.parse(
      readFileSync(join(root, "xbrief", "proposed", "2026-01-01-foo.json"), "utf8"),
    );
    expect(afterSecond.narratives.Note).toBe("waiting on design\nstill waiting");
  });

  it("duplicate requires a winning-uri", () => {
    const root = tempGitRepo();
    writeScopeFixture(root, "proposed", "2026-01-01-foo.json");

    const result = triageDecide(root, { verb: "duplicate", scope: "2026-01-01-foo.json" });

    expect(result).toMatchObject({ ok: false, code: 2 });
  });

  it("duplicate cancels and adds a scope/internal reference to the winning uri", () => {
    const root = tempGitRepo();
    writeScopeFixture(root, "proposed", "2026-01-02-dup.json");

    const result = triageDecide(root, {
      verb: "duplicate",
      scope: "2026-01-02-dup.json",
      winningUri: "xbrief/pending/2026-01-01-winner.json",
    });

    expect(result).toMatchObject({ ok: true, status: "cancelled" });
    const written = JSON.parse(
      readFileSync(join(root, "xbrief", "cancelled", "2026-01-02-dup.json"), "utf8"),
    );
    expect(written.references).toContainEqual({
      uri: "xbrief/pending/2026-01-01-winner.json",
      type: "scope",
      trust: "internal",
    });
  });

  it("refuses to triage a scope that is not in proposed/", () => {
    const root = tempGitRepo();
    writeScopeFixture(root, "pending", "2026-01-01-foo.json", {
      plan: {
        status: "pending",
        created: "2026-01-01T00:00:00.000Z",
        updated: "2026-01-01T00:00:00.000Z",
      },
    });

    const result = triageDecide(root, { verb: "accept", scope: "2026-01-01-foo.json" });

    expect(result).toMatchObject({ ok: false, code: 1 });
  });

  it("unknown scope id is a config error (exit 2)", () => {
    const root = tempGitRepo();

    const result = triageDecide(root, { verb: "accept", scope: "does-not-exist.json" });

    expect(result).toMatchObject({ ok: false, code: 2 });
  });
});
