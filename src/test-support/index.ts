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

/** Create xbrief/ with the five lifecycle dirs and a minimal PROJECT.json. */
export function scaffoldXbrief(root: string): void {
  for (const folder of ["proposed", "pending", "active", "completed", "cancelled"]) {
    mkdirSync(join(root, "xbrief", folder), { recursive: true });
    writeFileSync(join(root, "xbrief", folder, ".gitkeep"), "");
  }
  writeFileSync(
    join(root, "xbrief", "PROJECT.json"),
    `${JSON.stringify({ title: "test-project", policy: {} }, null, 2)}\n`,
  );
}

/** Minimal valid scope file body for fixtures. */
export function scopeFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = "2026-01-01T00:00:00.000Z";
  return {
    title: "Test scope",
    kind: "story",
    plan: { status: "proposed", created: now, updated: now },
    narratives: { Description: "test", Acceptance: "observable outcome" },
    items: [{ id: "ac1", text: "does the thing", done: false }],
    references: [],
    ...overrides,
  };
}

/** Write a scope fixture into a lifecycle folder; returns the relative path. */
export function writeScopeFixture(
  root: string,
  folder: string,
  filename: string,
  overrides: Record<string, unknown> = {},
): string {
  const rel = join("xbrief", folder, filename);
  mkdirSync(join(root, "xbrief", folder), { recursive: true });
  writeFileSync(join(root, rel), `${JSON.stringify(scopeFixture(overrides), null, 2)}\n`);
  return rel;
}
