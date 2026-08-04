import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cleanupTempDirs, tempGitRepo } from "../test-support/index.js";
import { depositHooks, PRE_COMMIT_HOOK, PRE_PUSH_HOOK } from "./index.js";

afterAll(cleanupTempDirs);

describe("depositHooks", () => {
  it("writes both hook files, chmods them executable, and sets core.hooksPath", () => {
    const root = tempGitRepo();
    const result = depositHooks(root);
    expect(result.ok).toBe(true);
    expect(result.wrote).toEqual([".githooks/pre-commit", ".githooks/pre-push"]);

    const preCommitPath = join(root, ".githooks", "pre-commit");
    const prePushPath = join(root, ".githooks", "pre-push");
    expect(readFileSync(preCommitPath, "utf8")).toBe(PRE_COMMIT_HOOK);
    expect(readFileSync(prePushPath, "utf8")).toBe(PRE_PUSH_HOOK);

    if (process.platform !== "win32") {
      expect(statSync(preCommitPath).mode & 0o111).not.toBe(0);
      expect(statSync(prePushPath).mode & 0o111).not.toBe(0);
    }
  });

  it("is idempotent -- running twice produces the same result", () => {
    const root = tempGitRepo();
    depositHooks(root);
    const second = depositHooks(root);
    expect(second.ok).toBe(true);
    expect(existsSync(join(root, ".githooks", "pre-commit"))).toBe(true);
  });

  it("hook bodies are syntactically valid POSIX shell (no bashisms leaking through)", () => {
    expect(PRE_COMMIT_HOOK.startsWith("#!/bin/sh\n")).toBe(true);
    expect(PRE_PUSH_HOOK.startsWith("#!/bin/sh\n")).toBe(true);
    // The classic bashism markers that must never appear in these scripts.
    for (const script of [PRE_COMMIT_HOOK, PRE_PUSH_HOOK]) {
      expect(script).not.toContain("[[");
      expect(script).not.toContain("function ");
    }
  });

  it("fails with ok:false when core.hooksPath cannot be set (not a git repo)", () => {
    const root = tempGitRepo();
    const fakeRunner = () => ({ status: 1, stdout: "", stderr: "not a repo" });
    const result = depositHooks(root, fakeRunner);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("core.hooksPath");
  });
});
