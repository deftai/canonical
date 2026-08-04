import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cleanupTempDirs, tempDir, tempGitRepo } from "../test-support/index.js";
import { AGENTS_MANAGED_CLOSE, AGENTS_MANAGED_OPEN } from "./agents-md.js";
import { runInit } from "./run-init.js";
import { CANONICAL_TASKFILE_INCLUDE } from "./taskfile.js";

afterAll(() => {
  cleanupTempDirs();
});

function hooksPath(root: string): string {
  try {
    return execFileSync("git", ["-C", root, "config", "--get", "core.hooksPath"], {
      encoding: "utf8",
    }).trim();
  } catch {
    return "";
  }
}

describe("runInit", () => {
  it("deposits the full payload into a fresh repo", () => {
    const root = tempGitRepo({ withBriefs: false });
    const result = runInit(root);

    expect(result.code).toBe(0);

    for (const md of [
      "canonical.md",
      "canonical-tasks.md",
      "engineering.md",
      "multi-agent.md",
      "scm.md",
      "state.md",
    ]) {
      expect(existsSync(join(root, ".canonical", "core", md))).toBe(true);
    }
    expect(existsSync(join(root, ".canonical", "core", "Taskfile.yml"))).toBe(true);
    expect(existsSync(join(root, ".canonical", "core", "tasks", "engine.yml"))).toBe(true);
    expect(existsSync(join(root, ".canonical", "core", ".githooks", "pre-commit"))).toBe(true);

    // VERSION
    const version = readFileSync(join(root, ".canonical", "core", "VERSION"), "utf8");
    expect(version).toContain("fetched_by: canon-init");
    expect(version).toMatch(/install_root: \.canonical\/core/);
    expect(version).toMatch(/fetched_at: \d{4}-\d{2}-\d{2}T/);

    // AGENTS.md managed section
    const agents = readFileSync(join(root, "AGENTS.md"), "utf8");
    expect(agents).toContain(AGENTS_MANAGED_OPEN);
    expect(agents).toContain(AGENTS_MANAGED_CLOSE);
    expect(agents).toContain("Read .canonical/core/canonical.md");

    // Taskfile.yml probe
    const taskfile = readFileSync(join(root, "Taskfile.yml"), "utf8");
    expect(taskfile).toContain(CANONICAL_TASKFILE_INCLUDE);

    // .gitignore baseline
    const gitignore = readFileSync(join(root, ".gitignore"), "utf8");
    expect(gitignore).toContain(".canonical/core/");
    expect(gitignore).toContain(".canonical/cache/");
    expect(gitignore).toContain("briefs/*.lock");

    // briefs/ scaffold
    for (const folder of ["proposed", "pending", "active", "completed", "cancelled"]) {
      expect(existsSync(join(root, "briefs", folder, ".gitkeep"))).toBe(true);
    }
    const project = JSON.parse(readFileSync(join(root, "briefs", "PROJECT.json"), "utf8"));
    expect(project).toEqual({ title: expect.any(String), policy: {} });

    // git hooks wired
    expect(existsSync(join(root, ".githooks", "pre-commit"))).toBe(true);
    expect(existsSync(join(root, ".githooks", "pre-push"))).toBe(true);
    expect(hooksPath(root)).toBe(".githooks");
  });

  it("is idempotent -- a second run reports the payload as skipped", () => {
    const root = tempGitRepo({ withBriefs: false });
    const first = runInit(root);
    expect(first.code).toBe(0);
    const firstAgents = readFileSync(join(root, "AGENTS.md"), "utf8");
    const firstTaskfile = readFileSync(join(root, "Taskfile.yml"), "utf8");

    const second = runInit(root);
    expect(second.code).toBe(0);
    expect(second.skipped).toContain(".canonical/core/canonical.md");
    expect(second.skipped).toContain("AGENTS.md");
    expect(second.skipped).toContain("Taskfile.yml");
    expect(second.skipped).toContain(".gitignore");

    // Content is unchanged, not duplicated.
    expect(readFileSync(join(root, "AGENTS.md"), "utf8")).toBe(firstAgents);
    expect(readFileSync(join(root, "Taskfile.yml"), "utf8")).toBe(firstTaskfile);
  });

  it("appends to an existing AGENTS.md and inserts into an existing Taskfile.yml includes:", () => {
    const root = tempGitRepo({ withBriefs: false });
    writeFileSync(join(root, "AGENTS.md"), "# Existing docs\n\nDo not remove this.\n");
    writeFileSync(
      join(root, "Taskfile.yml"),
      "version: '3'\n\nincludes:\n  other:\n    taskfile: ./tasks/other.yml\n",
    );

    const result = runInit(root);
    expect(result.code).toBe(0);

    const agents = readFileSync(join(root, "AGENTS.md"), "utf8");
    expect(agents).toContain("Do not remove this.");
    expect(agents).toContain(AGENTS_MANAGED_OPEN);

    const taskfile = readFileSync(join(root, "Taskfile.yml"), "utf8");
    expect(taskfile).toContain("other:");
    expect(taskfile).toContain(CANONICAL_TASKFILE_INCLUDE);
  });

  it("exits 2 for a non-existent project root", () => {
    const result = runInit("/definitely/not/a/real/path/xyz");
    expect(result.code).toBe(2);
  });

  it("warns instead of failing when the project root is not a git repo", () => {
    const plain = tempDir("canon-plain-");
    const result = runInit(plain);
    expect(result.code).toBe(0);
    expect(result.warnings.some((w) => w.includes("not a git repository"))).toBe(true);
  });
});
