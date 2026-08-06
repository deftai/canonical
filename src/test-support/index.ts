import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Shared test helpers. NOT exported to production paths; excluded from
 * coverage. Temp repos use realpathSync(tmpdir()) because macOS /var is a
 * symlink to /private/var and git resolves it.
 */

const GIT_ENV = {
  GIT_AUTHOR_NAME: "canon-test",
  GIT_AUTHOR_EMAIL: "canon-test@example.invalid",
  GIT_COMMITTER_NAME: "canon-test",
  GIT_COMMITTER_EMAIL: "canon-test@example.invalid",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
} as const;

export function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...GIT_ENV },
  });
}

const cleanups: string[] = [];

/** mkdtemp under the real tmpdir; caller cleans via cleanupTempDirs() in afterAll. */
export function tempDir(prefix = "canon-test-"): string {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), prefix));
  cleanups.push(dir);
  return dir;
}

export function cleanupTempDirs(): void {
  for (const dir of cleanups.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

export interface TempRepoOptions {
  readonly branch?: string;
  readonly withBriefs?: boolean;
}

/** Init a real git repo in a temp dir with one commit; optionally scaffold xbrief/. */
export function tempGitRepo(opts: TempRepoOptions = {}): string {
  const root = tempDir("canon-repo-");
  git(root, "init", "-q");
  git(root, "branch", "-M", opts.branch ?? "main");
  writeFileSync(join(root, "README.md"), "# test\n");
  if (opts.withBriefs !== false) {
    scaffoldXbrief(root);
  }
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "init");
  return root;
}

/** Create xbrief/ with the five lifecycle dirs and a minimal PROJECT.xbrief.json. */
export function scaffoldXbrief(root: string): void {
  for (const folder of ["proposed", "pending", "active", "completed", "cancelled"]) {
    mkdirSync(join(root, "xbrief", folder), { recursive: true });
    writeFileSync(join(root, "xbrief", folder, ".gitkeep"), "");
  }
  writeFileSync(
    join(root, "xbrief", "PROJECT.xbrief.json"),
    `${JSON.stringify(
      {
        xBRIEFInfo: { version: "0.8" },
        plan: { title: "test-project", status: "running", items: [], "x-canonical/policy": {} },
      },
      null,
      2,
    )}\n`,
  );
}

/** Acceptance criterion as a spec PlanItem ({id, title, status}). */
export function acceptanceItem(id: string, title: string, done = false): Record<string, unknown> {
  return { id, title, status: done ? "completed" : "pending" };
}

/**
 * Minimal valid scope document (xBRIEF v0.8 envelope) for fixtures.
 * `planOverrides` merge into `plan`; `rootOverrides` merge at document root.
 */
export function scopeFixture(
  planOverrides: Record<string, unknown> = {},
  rootOverrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const now = "2026-01-01T00:00:00.000Z";
  return {
    xBRIEFInfo: { version: "0.8" },
    plan: {
      title: "Test scope",
      status: "proposed",
      created: now,
      updated: now,
      items: [acceptanceItem("ac1", "does the thing")],
      narratives: { Description: "test", Acceptance: "observable outcome" },
      references: [],
      "x-canonical/kind": "story",
      ...planOverrides,
    },
    ...rootOverrides,
  };
}

/** Write a scope fixture into a lifecycle folder; returns the relative path. */
export function writeScopeFixture(
  root: string,
  folder: string,
  filename: string,
  planOverrides: Record<string, unknown> = {},
  rootOverrides: Record<string, unknown> = {},
): string {
  const rel = join("xbrief", folder, filename);
  mkdirSync(join(root, "xbrief", folder), { recursive: true });
  writeFileSync(
    join(root, rel),
    `${JSON.stringify(scopeFixture(planOverrides, rootOverrides), null, 2)}\n`,
  );
  return rel;
}
