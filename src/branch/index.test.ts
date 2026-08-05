import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cleanupTempDirs, git, tempGitRepo } from "../test-support/index.js";
import { ENV_ALLOW_DEFAULT_BRANCH_COMMIT, evaluateBranch } from "./index.js";

afterAll(cleanupTempDirs);

function writeProjectJson(root: string, body: unknown): void {
  writeFileSync(join(root, "xbrief", "PROJECT.json"), JSON.stringify(body));
}

describe("evaluateBranch", () => {
  it("exits 0 on a feature branch", () => {
    const root = tempGitRepo({ branch: "main" });
    git(root, "switch", "-c", "feat/x");
    const result = evaluateBranch(root);
    expect(result.code).toBe(0);
    expect(result.override).toBeNull();
    expect(result.message).toContain("feat/x");
  });

  it("exits 1 on the default branch with no override", () => {
    const root = tempGitRepo({ branch: "main" });
    const result = evaluateBranch(root, { env: {} });
    expect(result.code).toBe(1);
    expect(result.override).toBeNull();
    expect(result.message).toContain("default branch 'main'");
  });

  it("exits 0 when ALLOW_DEFAULT_BRANCH_COMMIT=1 is set", () => {
    const root = tempGitRepo({ branch: "main" });
    const result = evaluateBranch(root, {
      env: { [ENV_ALLOW_DEFAULT_BRANCH_COMMIT]: "1" },
    });
    expect(result.code).toBe(0);
    expect(result.override).toBe("env");
  });

  it("exits 0 when policy.allowDirectCommitsToDefault is true", () => {
    const root = tempGitRepo({ branch: "main" });
    writeProjectJson(root, { policy: { allowDirectCommitsToDefault: true } });
    const result = evaluateBranch(root, { env: {} });
    expect(result.code).toBe(0);
    expect(result.override).toBe("policy");
  });

  it("prefers the env override over the policy override when both apply", () => {
    const root = tempGitRepo({ branch: "main" });
    writeProjectJson(root, { policy: { allowDirectCommitsToDefault: true } });
    const result = evaluateBranch(root, {
      env: { [ENV_ALLOW_DEFAULT_BRANCH_COMMIT]: "1" },
    });
    expect(result.override).toBe("env");
  });

  it("exits 2 when PROJECT.json is malformed and no override applies", () => {
    const root = tempGitRepo({ branch: "main" });
    writeFileSync(join(root, "xbrief", "PROJECT.json"), "{not json");
    const result = evaluateBranch(root, { env: {} });
    expect(result.code).toBe(2);
    expect(result.message).toContain("cannot resolve policy");
  });

  it("exits 0 for detached HEAD -- nothing to gate", () => {
    const root = tempGitRepo({ branch: "main" });
    git(root, "checkout", "--detach", "HEAD");
    const result = evaluateBranch(root);
    expect(result.code).toBe(0);
    expect(result.message).toContain("detached HEAD");
  });
});
