import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cleanupTempDirs, git, tempDir, tempGitRepo } from "../test-support/index.js";
import { depositHooks } from "./index.js";

/**
 * Execute the ACTUAL deposited hook scripts under `sh`, per the Stream C
 * brief: exercise them as a real shell would, not just assert on the string
 * constants. A fake $CANON_HOOKS_BIN recorder script proves pre-commit
 * resolves and invokes the right verbs in the right order with the right
 * flags; synthetic stdin proves pre-push's default-branch refusal + bypass.
 */

afterAll(cleanupTempDirs);

/** Write a POSIX-sh recorder that appends its argv to a log file and exits with $CANON_RECORD_EXIT. */
function writeRecorder(dir: string): string {
  const path = join(dir, "canon-recorder.sh");
  writeFileSync(
    path,
    `#!/bin/sh\necho "$@" >> "$CANON_RECORD_LOG"\nexit "\${CANON_RECORD_EXIT:-0}"\n`,
  );
  chmodSync(path, 0o755);
  return path;
}

function readLog(path: string): string[] {
  try {
    return readFileSync(path, "utf8")
      .split("\n")
      .filter((l) => l.length > 0);
  } catch {
    return [];
  }
}

describe(".githooks/pre-commit (executed via sh)", () => {
  it("invokes verify:branch, verify:encoding --staged, verify:forward-coverage --staged, state:validate in order", () => {
    const root = tempGitRepo();
    depositHooks(root);
    const scratch = tempDir("canon-hook-scratch-");
    const recorder = writeRecorder(scratch);
    const log = join(scratch, "calls.log");

    const out = execFileSync("sh", [join(root, ".githooks", "pre-commit")], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, CANON_HOOKS_BIN: recorder, CANON_RECORD_LOG: log },
    });

    const calls = readLog(log);
    expect(calls).toEqual([
      `verify:branch --project-root ${root}`,
      `verify:encoding --staged --project-root ${root}`,
      `verify:forward-coverage --staged --project-root ${root}`,
      `state:validate --project-root ${root}`,
    ]);
    expect(out).toBe("");
  });

  it("stops at the first failing verb and exits with that code", () => {
    const root = tempGitRepo();
    depositHooks(root);
    const scratch = tempDir("canon-hook-scratch-");
    const recorder = writeRecorder(scratch);
    const log = join(scratch, "calls.log");

    let status = 0;
    try {
      execFileSync("sh", [join(root, ".githooks", "pre-commit")], {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          CANON_HOOKS_BIN: recorder,
          CANON_RECORD_LOG: log,
          CANON_RECORD_EXIT: "1",
        },
      });
    } catch (err) {
      status = (err as { status: number }).status;
    }

    expect(status).toBe(1);
    // Only the first verb ran -- the hook must not continue past a failure.
    expect(readLog(log)).toEqual([`verify:branch --project-root ${root}`]);
  });

  it("fails closed with exit 2 when the canon CLI cannot be resolved", () => {
    const root = tempGitRepo();
    depositHooks(root);

    let status = 0;
    let stderr = "";
    try {
      // A minimal PATH with just enough to run git/sh, but no `canon` binary
      // and no framework-source sentinel (pnpm-workspace.yaml) in this temp
      // repo -- CANON_HOOKS_BIN is deliberately left unset.
      execFileSync("sh", [join(root, ".githooks", "pre-commit")], {
        cwd: root,
        encoding: "utf8",
        env: { PATH: "/usr/bin:/bin" },
      });
    } catch (err) {
      const e = err as { status: number; stderr: string };
      status = e.status;
      stderr = e.stderr;
    }

    expect(status).toBe(2);
    expect(stderr).toContain("cannot resolve the canon CLI");
  });
});

describe(".githooks/pre-push (executed via sh)", () => {
  it("refuses to delete the default branch ref", () => {
    const root = tempGitRepo({ branch: "main" });
    depositHooks(root);
    const headSha = git(root, "rev-parse", "HEAD").trim();
    const zero = "0".repeat(40);
    const stdin = `refs/heads/main ${zero} refs/heads/main ${headSha}\n`;

    let status = 0;
    let stderr = "";
    try {
      execFileSync("sh", [join(root, ".githooks", "pre-push")], {
        cwd: root,
        encoding: "utf8",
        input: stdin,
      });
    } catch (err) {
      const e = err as { status: number; stderr: string };
      status = e.status;
      stderr = e.stderr;
    }

    expect(status).toBe(1);
    expect(stderr).toContain("refusing to delete default branch ref");
  });

  it("refuses a force-update of the default branch ref", () => {
    const root = tempGitRepo({ branch: "main" });
    // Build the diverging history BEFORE depositHooks -- depositHooks sets
    // core.hooksPath to the very pre-commit hook under test, and `git commit`
    // would otherwise invoke it (and fail closed with no canon CLI resolvable).
    const baseSha = git(root, "rev-parse", "HEAD").trim();
    git(root, "commit", "--allow-empty", "-q", "-m", "diverge on remote");
    const remoteSha = git(root, "rev-parse", "HEAD").trim();
    git(root, "reset", "--hard", baseSha);
    git(root, "commit", "--allow-empty", "-q", "-m", "diverge on local");
    const localSha = git(root, "rev-parse", "HEAD").trim();
    depositHooks(root);

    const stdin = `refs/heads/main ${localSha} refs/heads/main ${remoteSha}\n`;

    let status = 0;
    let stderr = "";
    try {
      execFileSync("sh", [join(root, ".githooks", "pre-push")], {
        cwd: root,
        encoding: "utf8",
        input: stdin,
      });
    } catch (err) {
      const e = err as { status: number; stderr: string };
      status = e.status;
      stderr = e.stderr;
    }

    expect(status).toBe(1);
    expect(stderr).toContain("refusing to force-update default branch ref");
  });

  it("allows a normal fast-forward push to the default branch", () => {
    const root = tempGitRepo({ branch: "main" });
    const baseSha = git(root, "rev-parse", "HEAD").trim();
    git(root, "commit", "--allow-empty", "-q", "-m", "fast-forward commit");
    const newSha = git(root, "rev-parse", "HEAD").trim();
    depositHooks(root);
    const stdin = `refs/heads/main ${newSha} refs/heads/main ${baseSha}\n`;

    const out = execFileSync("sh", [join(root, ".githooks", "pre-push")], {
      cwd: root,
      encoding: "utf8",
      input: stdin,
    });
    expect(out).toBe("");
  });

  it("ignores pushes to a non-default branch even if they delete the remote ref", () => {
    const root = tempGitRepo({ branch: "main" });
    depositHooks(root);
    const headSha = git(root, "rev-parse", "HEAD").trim();
    const zero = "0".repeat(40);
    const stdin = `refs/heads/feature ${zero} refs/heads/feature ${headSha}\n`;

    const out = execFileSync("sh", [join(root, ".githooks", "pre-push")], {
      cwd: root,
      encoding: "utf8",
      input: stdin,
    });
    expect(out).toBe("");
  });

  it("ALLOW_DESTRUCTIVE_GIT=1 bypasses the refusal and prints an audit line to stderr", () => {
    const root = tempGitRepo({ branch: "main" });
    depositHooks(root);
    const headSha = git(root, "rev-parse", "HEAD").trim();
    const zero = "0".repeat(40);
    const stdin = `refs/heads/main ${zero} refs/heads/main ${headSha}\n`;

    // execFileSync only exposes stderr on failure; run via spawnSync to see
    // stderr on a clean (bypassed) exit too.
    const result = spawnSync("sh", [join(root, ".githooks", "pre-push")], {
      cwd: root,
      encoding: "utf8",
      input: stdin,
      env: { ...process.env, ALLOW_DESTRUCTIVE_GIT: "1" },
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("canon: destructive-git policy bypassed for this push");
  });
});
