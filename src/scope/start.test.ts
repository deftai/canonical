import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { atomicWriteJson } from "../fs/contained-write.js";
import { cleanupTempDirs, git, tempGitRepo, writeScopeFixture } from "../test-support/index.js";
import { scopeStart } from "./start.js";

afterAll(() => {
  cleanupTempDirs();
});

/** writeScopeFixture leaves the file untracked; commit it so the tree reads clean. */
function commitAll(root: string): void {
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "fixture");
}

describe("scopeStart", () => {
  it("promotes proposed -> pending -> active/running in one transaction, off the default branch", () => {
    const root = tempGitRepo();
    git(root, "checkout", "-q", "-b", "feature/foo");
    writeScopeFixture(root, "proposed", "2026-01-01-foo.xbrief.json");
    commitAll(root);

    const result = scopeStart(root, { scope: "2026-01-01-foo.xbrief.json" });

    expect(result).toMatchObject({ ok: true, status: "running" });
    const written = JSON.parse(
      readFileSync(join(root, "xbrief", "active", "2026-01-01-foo.xbrief.json"), "utf8"),
    );
    expect(written.plan.status).toBe("running");

    const audit = readFileSync(join(root, "xbrief", "audit.jsonl"), "utf8");
    expect(audit).toContain("proposed->pending");
    expect(audit).toContain("pending->running");
  });

  it("starts directly from pending/ without a promotion step", () => {
    const root = tempGitRepo();
    git(root, "checkout", "-q", "-b", "feature/foo");
    writeScopeFixture(root, "pending", "2026-01-01-foo.xbrief.json", {
      status: "pending",
      created: "2026-01-01T00:00:00.000Z",
      updated: "2026-01-01T00:00:00.000Z",
    });
    commitAll(root);

    const result = scopeStart(root, { scope: "2026-01-01-foo.xbrief.json" });

    expect(result).toMatchObject({ ok: true, status: "running" });
    const audit = readFileSync(join(root, "xbrief", "audit.jsonl"), "utf8");
    expect(audit).not.toContain("proposed->pending");
    expect(audit).toContain("pending->running");
  });

  it("gate: refuses a dirty tree without --allow-dirty", () => {
    const root = tempGitRepo();
    git(root, "checkout", "-q", "-b", "feature/foo");
    writeScopeFixture(root, "pending", "2026-01-01-foo.xbrief.json", {
      status: "pending",
      created: "2026-01-01T00:00:00.000Z",
      updated: "2026-01-01T00:00:00.000Z",
    });
    writeFileSync(join(root, "dirty.txt"), "uncommitted\n");

    const result = scopeStart(root, { scope: "2026-01-01-foo.xbrief.json" });

    expect(result).toMatchObject({ ok: false, code: 1 });
    expect((result as { message: string }).message).toMatch(/dirty/);
  });

  it("gate: --allow-dirty overrides the dirty-tree gate", () => {
    const root = tempGitRepo();
    git(root, "checkout", "-q", "-b", "feature/foo");
    writeScopeFixture(root, "pending", "2026-01-01-foo.xbrief.json", {
      status: "pending",
      created: "2026-01-01T00:00:00.000Z",
      updated: "2026-01-01T00:00:00.000Z",
    });
    writeFileSync(join(root, "dirty.txt"), "uncommitted\n");

    const result = scopeStart(root, { scope: "2026-01-01-foo.xbrief.json", allowDirty: true });

    expect(result).toMatchObject({ ok: true, status: "running" });
  });

  it("gate: refuses to start on the default branch when policy forbids direct commits", () => {
    const root = tempGitRepo();
    writeScopeFixture(root, "pending", "2026-01-01-foo.xbrief.json", {
      status: "pending",
      created: "2026-01-01T00:00:00.000Z",
      updated: "2026-01-01T00:00:00.000Z",
    });
    commitAll(root);

    const result = scopeStart(root, { scope: "2026-01-01-foo.xbrief.json" });

    expect(result).toMatchObject({ ok: false, code: 1 });
    expect((result as { message: string }).message).toMatch(/default branch/);
  });

  it("gate: allowDirectCommitsToDefault policy permits starting on the default branch", () => {
    const root = tempGitRepo();
    atomicWriteJson(root, "xbrief/PROJECT.xbrief.json", {
      xBRIEFInfo: { version: "0.8" },
      plan: {
        title: "t",
        status: "running",
        items: [],
        "x-canonical/policy": { allowDirectCommitsToDefault: true },
      },
    });
    writeScopeFixture(root, "pending", "2026-01-01-foo.xbrief.json", {
      status: "pending",
      created: "2026-01-01T00:00:00.000Z",
      updated: "2026-01-01T00:00:00.000Z",
    });
    commitAll(root);

    const result = scopeStart(root, { scope: "2026-01-01-foo.xbrief.json" });

    expect(result).toMatchObject({ ok: true, status: "running" });
  });

  it("cannot start a scope that is already completed", () => {
    const root = tempGitRepo();
    git(root, "checkout", "-q", "-b", "feature/foo");
    writeScopeFixture(root, "completed", "2026-01-01-foo.xbrief.json", {
      status: "completed",
      created: "2026-01-01T00:00:00.000Z",
      updated: "2026-01-01T00:00:00.000Z",
    });

    const result = scopeStart(root, { scope: "2026-01-01-foo.xbrief.json" });

    expect(result).toMatchObject({ ok: false, code: 1 });
    expect((result as { message: string }).message).toMatch(/status 'completed'/);
  });

  it("--check verifies active/running/clean without transitioning", () => {
    const root = tempGitRepo();
    git(root, "checkout", "-q", "-b", "feature/foo");
    writeScopeFixture(root, "active", "2026-01-01-foo.xbrief.json", {
      status: "running",
      created: "2026-01-01T00:00:00.000Z",
      updated: "2026-01-01T00:00:00.000Z",
    });
    commitAll(root);

    const result = scopeStart(root, { scope: "2026-01-01-foo.xbrief.json", check: true });

    expect(result).toMatchObject({ ok: true, status: "running", checked: true });
  });

  it("--check fails when status is not running", () => {
    const root = tempGitRepo();
    writeScopeFixture(root, "active", "2026-01-01-foo.xbrief.json", {
      status: "blocked",
      created: "2026-01-01T00:00:00.000Z",
      updated: "2026-01-01T00:00:00.000Z",
    });

    const result = scopeStart(root, { scope: "2026-01-01-foo.xbrief.json", check: true });

    expect(result).toMatchObject({ ok: false, code: 1 });
  });

  it("--check fails when the tree is dirty", () => {
    const root = tempGitRepo();
    writeScopeFixture(root, "active", "2026-01-01-foo.xbrief.json", {
      status: "running",
      created: "2026-01-01T00:00:00.000Z",
      updated: "2026-01-01T00:00:00.000Z",
    });
    writeFileSync(join(root, "dirty.txt"), "uncommitted\n");

    const result = scopeStart(root, { scope: "2026-01-01-foo.xbrief.json", check: true });

    expect(result).toMatchObject({ ok: false, code: 1 });
  });

  it("unknown scope id is a config error (exit 2)", () => {
    const root = tempGitRepo();

    const result = scopeStart(root, { scope: "nope.xbrief.json" });

    expect(result).toMatchObject({ ok: false, code: 2 });
  });
});
