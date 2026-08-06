import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cleanupTempDirs, tempGitRepo, writeScopeFixture } from "../test-support/index.js";
import { scopeStop } from "./stop.js";

afterAll(() => {
  cleanupTempDirs();
});

function status(overrides: Record<string, unknown> = {}) {
  return {
    status: "proposed",
    created: "2026-01-01T00:00:00.000Z",
    updated: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function auditLines(root: string): unknown[] {
  const raw = readFileSync(join(root, "xbrief", "audit.jsonl"), "utf8");
  return raw
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l));
}

describe("scopeStop", () => {
  it("cancel from a non-terminal status moves to cancelled/", () => {
    const root = tempGitRepo();
    writeScopeFixture(root, "pending", "2026-01-01-foo.xbrief.json", status({ status: "pending" }));

    const result = scopeStop(root, { scope: "2026-01-01-foo.xbrief.json", mode: "cancel" });

    expect(result).toMatchObject({ ok: true, status: "cancelled" });
    expect(() =>
      readFileSync(join(root, "xbrief", "cancelled", "2026-01-01-foo.xbrief.json")),
    ).not.toThrow();
    expect(auditLines(root)).toContainEqual(
      expect.objectContaining({
        kind: "scope-stop",
        mode: "cancel",
        from: "pending",
        to: "cancelled",
      }),
    );
  });

  it("cancel from a terminal status is illegal", () => {
    const root = tempGitRepo();
    writeScopeFixture(
      root,
      "completed",
      "2026-01-01-foo.xbrief.json",
      status({ status: "completed" }),
    );

    const result = scopeStop(root, { scope: "2026-01-01-foo.xbrief.json", mode: "cancel" });

    expect(result).toMatchObject({ ok: false, code: 1 });
    expect((result as { message: string }).message).toContain("completed");
  });

  it("fail from active (running) moves to completed/failed", () => {
    const root = tempGitRepo();
    writeScopeFixture(root, "active", "2026-01-01-foo.xbrief.json", status({ status: "running" }));

    const result = scopeStop(root, { scope: "2026-01-01-foo.xbrief.json", mode: "fail" });

    expect(result).toMatchObject({ ok: true, status: "failed" });
    expect(() =>
      readFileSync(join(root, "xbrief", "completed", "2026-01-01-foo.xbrief.json")),
    ).not.toThrow();
  });

  it("fail from pending is illegal", () => {
    const root = tempGitRepo();
    writeScopeFixture(root, "pending", "2026-01-01-foo.xbrief.json", status({ status: "pending" }));

    const result = scopeStop(root, { scope: "2026-01-01-foo.xbrief.json", mode: "fail" });

    expect(result).toMatchObject({ ok: false, code: 1 });
  });

  it("block from running stays in active/ as blocked", () => {
    const root = tempGitRepo();
    writeScopeFixture(root, "active", "2026-01-01-foo.xbrief.json", status({ status: "running" }));

    const result = scopeStop(root, { scope: "2026-01-01-foo.xbrief.json", mode: "block" });

    expect(result).toMatchObject({ ok: true, status: "blocked" });
    const written = JSON.parse(
      readFileSync(join(root, "xbrief", "active", "2026-01-01-foo.xbrief.json"), "utf8"),
    );
    expect(written.plan.status).toBe("blocked");
  });

  it("block from blocked is illegal", () => {
    const root = tempGitRepo();
    writeScopeFixture(root, "active", "2026-01-01-foo.xbrief.json", status({ status: "blocked" }));

    const result = scopeStop(root, { scope: "2026-01-01-foo.xbrief.json", mode: "block" });

    expect(result).toMatchObject({ ok: false, code: 1 });
  });

  it("unblock from blocked returns to running", () => {
    const root = tempGitRepo();
    writeScopeFixture(root, "active", "2026-01-01-foo.xbrief.json", status({ status: "blocked" }));

    const result = scopeStop(root, { scope: "2026-01-01-foo.xbrief.json", mode: "unblock" });

    expect(result).toMatchObject({ ok: true, status: "running" });
  });

  it("unblock from running is illegal", () => {
    const root = tempGitRepo();
    writeScopeFixture(root, "active", "2026-01-01-foo.xbrief.json", status({ status: "running" }));

    const result = scopeStop(root, { scope: "2026-01-01-foo.xbrief.json", mode: "unblock" });

    expect(result).toMatchObject({ ok: false, code: 1 });
  });

  it("demote from active (running or blocked) moves to pending/", () => {
    const root = tempGitRepo();
    writeScopeFixture(root, "active", "2026-01-01-foo.xbrief.json", status({ status: "running" }));

    const result = scopeStop(root, { scope: "2026-01-01-foo.xbrief.json", mode: "demote" });

    expect(result).toMatchObject({ ok: true, status: "pending" });
  });

  it("demote from proposed is illegal", () => {
    const root = tempGitRepo();
    writeScopeFixture(
      root,
      "proposed",
      "2026-01-01-foo.xbrief.json",
      status({ status: "proposed" }),
    );

    const result = scopeStop(root, { scope: "2026-01-01-foo.xbrief.json", mode: "demote" });

    expect(result).toMatchObject({ ok: false, code: 1 });
  });

  it("records --note in narratives.Note and appends on repeat", () => {
    const root = tempGitRepo();
    writeScopeFixture(root, "active", "2026-01-01-foo.xbrief.json", status({ status: "running" }));

    const result = scopeStop(root, {
      scope: "2026-01-01-foo.xbrief.json",
      mode: "block",
      note: "blocked on upstream API",
    });

    expect(result).toMatchObject({ ok: true, status: "blocked" });
    const written = JSON.parse(
      readFileSync(join(root, "xbrief", "active", "2026-01-01-foo.xbrief.json"), "utf8"),
    );
    expect(written.plan.narratives.Note).toBe("blocked on upstream API");

    const second = scopeStop(root, {
      scope: "2026-01-01-foo.xbrief.json",
      mode: "unblock",
      note: "upstream fixed",
    });
    expect(second.ok).toBe(true);
    const rewritten = JSON.parse(
      readFileSync(join(root, "xbrief", "active", "2026-01-01-foo.xbrief.json"), "utf8"),
    );
    expect(rewritten.plan.narratives.Note).toBe("blocked on upstream API\nupstream fixed");
  });

  it("unknown scope id is a config error (exit 2)", () => {
    const root = tempGitRepo();

    const result = scopeStop(root, { scope: "nope.xbrief.json", mode: "cancel" });

    expect(result).toMatchObject({ ok: false, code: 2 });
  });
});
