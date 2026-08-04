import { spawnSync } from "node:child_process";

/**
 * The ONLY git entry point in this codebase. All calls are argv-array
 * spawnSync with shell:false -- never string-interpolated shell commands.
 * Every function takes an optional `runner` seam for tests.
 */

export interface GitResult {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

export type GitRunner = (cwd: string, args: readonly string[]) => GitResult;

export class GitNotFoundError extends Error {
  constructor() {
    super("git executable not found on PATH");
    this.name = "GitNotFoundError";
  }
}

export const defaultGitRunner: GitRunner = (cwd, args) => {
  const result = spawnSync("git", args as string[], {
    cwd,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });
  if (result.error !== undefined && (result.error as NodeJS.ErrnoException).code === "ENOENT") {
    throw new GitNotFoundError();
  }
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
};

/** Current branch name, or null when detached / not a repo. */
export function currentBranch(cwd: string, run: GitRunner = defaultGitRunner): string | null {
  const r = run(cwd, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  if (r.status !== 0) {
    return null;
  }
  return r.stdout.trim() || null;
}

/** The repository default branch (origin/HEAD, falling back to main/master presence). */
export function defaultBranch(cwd: string, run: GitRunner = defaultGitRunner): string {
  const remote = run(cwd, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]);
  if (remote.status === 0) {
    const name = remote.stdout.trim();
    const slash = name.indexOf("/");
    if (slash !== -1) {
      return name.slice(slash + 1);
    }
  }
  for (const candidate of ["main", "master"]) {
    const r = run(cwd, ["show-ref", "--verify", "--quiet", `refs/heads/${candidate}`]);
    if (r.status === 0) {
      return candidate;
    }
  }
  return "main";
}

export function isGitRepo(cwd: string, run: GitRunner = defaultGitRunner): boolean {
  try {
    return run(cwd, ["rev-parse", "--git-dir"]).status === 0;
  } catch {
    return false;
  }
}

/** True when the working tree has uncommitted changes (staged or unstaged). */
export function isDirty(cwd: string, run: GitRunner = defaultGitRunner): boolean {
  const r = run(cwd, ["status", "--porcelain"]);
  return r.status === 0 && r.stdout.trim().length > 0;
}

/** Paths staged for commit (Added/Modified/Renamed), relative to repo root. */
export function stagedFiles(cwd: string, run: GitRunner = defaultGitRunner): readonly string[] {
  const r = run(cwd, ["diff", "--cached", "--name-only", "--diff-filter=ACMR"]);
  if (r.status !== 0) {
    return [];
  }
  return r.stdout.split("\n").filter((l) => l.trim().length > 0);
}

/** Staged paths that are newly added (not present in HEAD). */
export function stagedNewFiles(cwd: string, run: GitRunner = defaultGitRunner): readonly string[] {
  const r = run(cwd, ["diff", "--cached", "--name-only", "--diff-filter=A"]);
  if (r.status !== 0) {
    return [];
  }
  return r.stdout.split("\n").filter((l) => l.trim().length > 0);
}

/** All tracked files, relative to repo root. */
export function trackedFiles(cwd: string, run: GitRunner = defaultGitRunner): readonly string[] {
  const r = run(cwd, ["ls-files", "-z"]);
  if (r.status !== 0) {
    return [];
  }
  return r.stdout.split("\0").filter((l) => l.length > 0);
}

/** True when `sha` is an ancestor of `branch` (delivery check). */
export function isAncestorOf(
  cwd: string,
  sha: string,
  branch: string,
  run: GitRunner = defaultGitRunner,
): boolean {
  return run(cwd, ["merge-base", "--is-ancestor", sha, branch]).status === 0;
}

/** Set a repo-local git config value (e.g. core.hooksPath). */
export function setConfig(
  cwd: string,
  key: string,
  value: string,
  run: GitRunner = defaultGitRunner,
): boolean {
  return run(cwd, ["config", key, value]).status === 0;
}
