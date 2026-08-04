import type { GateResult } from "@canonpack/types";
import { currentBranch, defaultBranch, type GitRunner } from "../git/index.js";
import { resolvePolicy } from "../policy/index.js";

/**
 * verify:branch (content/canonical-tasks.md): refuse commits made directly on
 * the default branch, unless an explicit override is in force. Pure function
 * of git state + policy -- no process.exit(), no I/O beyond the injectable
 * GitRunner seam.
 */

/** Env-var escape hatch, checked ahead of policy so it always short-circuits. */
export const ENV_ALLOW_DEFAULT_BRANCH_COMMIT = "ALLOW_DEFAULT_BRANCH_COMMIT";

export interface EvaluateBranchOptions {
  /** Injectable git seam (tests). Defaults to the real `git` binary. */
  readonly runner?: GitRunner;
  /** Injectable environment (tests). Defaults to `process.env`. */
  readonly env?: Readonly<Record<string, string | undefined>>;
}

export interface EvaluateBranchResult extends GateResult {
  /** Which override (if any) let a default-branch commit through. */
  readonly override: "env" | "policy" | null;
}

function envOverrideActive(env: Readonly<Record<string, string | undefined>>): boolean {
  return env[ENV_ALLOW_DEFAULT_BRANCH_COMMIT] === "1";
}

/**
 * Evaluate the branch-protection gate: exit 1 when HEAD is the repo's default
 * branch, unless `policy.allowDirectCommitsToDefault` is true or
 * `ALLOW_DEFAULT_BRANCH_COMMIT=1` -- whichever override matched is reported.
 */
export function evaluateBranch(
  projectRoot: string,
  opts: EvaluateBranchOptions = {},
): EvaluateBranchResult {
  const run = opts.runner;
  const env = opts.env ?? process.env;

  const branch = currentBranch(projectRoot, run);
  if (branch === null) {
    return {
      code: 0,
      override: null,
      message: "verify:branch: detached HEAD -- nothing to gate.",
    };
  }

  const base = defaultBranch(projectRoot, run);
  if (branch !== base) {
    return {
      code: 0,
      override: null,
      message: `verify:branch: on feature branch '${branch}' -- proceeding.`,
    };
  }

  // On the default branch: env override is checked first because it never
  // requires reading briefs/PROJECT.json (cheap, and wins if both are set).
  if (envOverrideActive(env)) {
    return {
      code: 0,
      override: "env",
      message:
        `verify:branch: on default branch '${branch}', but ` +
        `${ENV_ALLOW_DEFAULT_BRANCH_COMMIT}=1 override applied.`,
    };
  }

  const policy = resolvePolicy(projectRoot);
  if (!("error" in policy) && policy.allowDirectCommitsToDefault) {
    return {
      code: 0,
      override: "policy",
      message:
        `verify:branch: on default branch '${branch}', but ` +
        "policy.allowDirectCommitsToDefault override applied.",
    };
  }

  if ("error" in policy) {
    return {
      code: 2,
      override: null,
      message: `verify:branch: cannot resolve policy -- ${policy.error}`,
    };
  }

  return {
    code: 1,
    override: null,
    message:
      `verify:branch: refusing commit on default branch '${branch}'.\n` +
      "  Fix: create a feature branch (git switch -c feat/<name>), or set " +
      "policy.allowDirectCommitsToDefault=true in briefs/PROJECT.json, or " +
      `set ${ENV_ALLOW_DEFAULT_BRANCH_COMMIT}=1.`,
  };
}
