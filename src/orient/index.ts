import { spawnSync } from "node:child_process";
import { briefsExist } from "../briefs/index.js";
import { currentBranch, type GitRunner, isDirty, isGitRepo } from "../git/index.js";
import type { GateResult } from "../types/index.js";

/**
 * `orient` (content/canonical-tasks.md): first-mutation-of-session readiness
 * snapshot -- git status, briefs/ readable, core tools on PATH. No network,
 * no upgrades, no multi-minute doctoring.
 */

export interface ToolProbe {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

/** `spawnSync(bin, ["--version"])` seam so tests never depend on the real toolchain. */
export type ToolProbeFn = (bin: string) => ToolProbe;

const REQUIRED_TOOLS: readonly string[] = ["git", "node"];

export function defaultProbeTool(bin: string): ToolProbe {
  const result = spawnSync(bin, ["--version"], {
    shell: false,
    windowsHide: true,
    encoding: "utf8",
  });
  if (result.error !== undefined) {
    return { name: bin, ok: false, detail: result.error.message };
  }
  if (result.status !== 0) {
    return { name: bin, ok: false, detail: `exited ${result.status ?? "unknown"}` };
  }
  const firstLine = (result.stdout || result.stderr || "").trim().split("\n")[0] ?? "";
  return { name: bin, ok: true, detail: firstLine };
}

export interface OrientOptions {
  /** Skip the dirty-tree gate (still reported in the snapshot). */
  readonly allowDirty?: boolean;
  /** Injectable git seam (tests). Defaults to the real `git` binary. */
  readonly runner?: GitRunner;
  /** Injectable tool probe (tests). Defaults to spawnSync --version. */
  readonly probeTool?: ToolProbeFn;
}

export interface OrientSnapshot extends GateResult {
  readonly isGitRepo: boolean;
  readonly branch: string | null;
  readonly dirty: boolean;
  readonly briefsReadable: boolean;
  readonly tools: readonly ToolProbe[];
}

/**
 * Snapshot mutation-session readiness. Exit 0 ready, 1 when briefs/ is
 * missing or the tree is dirty without --allow-dirty, 2 when a required
 * tool (git, node) is broken -- checked first since nothing else is
 * trustworthy without a working toolchain.
 */
export function orient(projectRoot: string, opts: OrientOptions = {}): OrientSnapshot {
  const probeTool = opts.probeTool ?? defaultProbeTool;
  const tools = REQUIRED_TOOLS.map((bin) => probeTool(bin));
  const broken = tools.filter((t) => !t.ok);
  if (broken.length > 0) {
    return {
      code: 2,
      isGitRepo: false,
      branch: null,
      dirty: false,
      briefsReadable: false,
      tools,
      message: `orient: tool(s) broken -- ${broken.map((t) => `${t.name} (${t.detail})`).join(", ")}.`,
    };
  }

  const gitRepo = isGitRepo(projectRoot, opts.runner);
  const branch = gitRepo ? currentBranch(projectRoot, opts.runner) : null;
  const dirty = gitRepo ? isDirty(projectRoot, opts.runner) : false;
  const briefsReadable = briefsExist(projectRoot);

  if (!briefsReadable) {
    return {
      code: 1,
      isGitRepo: gitRepo,
      branch,
      dirty,
      briefsReadable,
      tools,
      message:
        "orient: briefs/ not found -- not ready for mutation (run `canon scope:new` after bootstrapping).",
    };
  }

  if (dirty && opts.allowDirty !== true) {
    return {
      code: 1,
      isGitRepo: gitRepo,
      branch,
      dirty,
      briefsReadable,
      tools,
      message: "orient: working tree is dirty -- pass --allow-dirty, or commit/stash first.",
    };
  }

  return {
    code: 0,
    isGitRepo: gitRepo,
    branch,
    dirty,
    briefsReadable,
    tools,
    message: `orient: ready on branch '${branch ?? "(detached)"}'.`,
  };
}
