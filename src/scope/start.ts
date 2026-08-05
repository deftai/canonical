import { currentBranch, defaultBranch, type GitRunner, isDirty, isGitRepo } from "../git/index.js";
import { resolvePolicy } from "../policy/index.js";
import { appendAudit } from "../xbrief/audit.js";
import { findScope, readScope, transitionScope } from "../xbrief/brief-io.js";

/**
 * `scope:start` verb (content/canonical-tasks.md #scope:start, content/state.md Lifecycle).
 * Transactional: proposed -> pending -> active/running in one call, gated on
 * a clean tree and (unless policy allows it) not being on the default branch.
 * `--check` verifies the gate without transitioning anything.
 */

export interface ScopeStartOptions {
  /** Identifier resolved via findScope (relative path, filename, or slug fragment). */
  readonly scope: string;
  /** Verify only: must already be active/running with a clean tree. */
  readonly check?: boolean;
  readonly allowDirty?: boolean;
  readonly now?: Date;
  /** Injectable git seam for tests. */
  readonly runner?: GitRunner;
}

export type ScopeStartResult =
  | {
      readonly ok: true;
      readonly scope: string;
      readonly status: "running";
      readonly checked?: boolean;
    }
  | { readonly ok: false; readonly code: 1 | 2; readonly message: string };

export function scopeStart(projectRoot: string, opts: ScopeStartOptions): ScopeStartResult {
  const now = opts.now ?? new Date();
  const runner = opts.runner;

  const found = findScope(projectRoot, opts.scope);
  if (found === null) {
    return { ok: false, code: 2, message: `no scope matching '${opts.scope}'` };
  }
  if ("ambiguous" in found) {
    return {
      ok: false,
      code: 2,
      message: `'${opts.scope}' is ambiguous: ${found.ambiguous.join(", ")}`,
    };
  }
  let ref = found;

  const readResult = readScope(ref.path);
  if (!readResult.ok) {
    return { ok: false, code: 2, message: readResult.message };
  }
  const scope = readResult.scope;

  if (opts.check === true) {
    if (ref.folder !== "active" || scope.plan.status !== "running") {
      return {
        ok: false,
        code: 1,
        message: `${ref.relPath} is not active/running (folder: ${ref.folder}, status: ${scope.plan.status})`,
      };
    }
    if (isDirty(projectRoot, runner)) {
      return { ok: false, code: 1, message: "git tree is dirty" };
    }
    return { ok: true, scope: ref.relPath, status: "running", checked: true };
  }

  const status = scope.plan.status;
  if (status !== "proposed" && status !== "pending") {
    return {
      ok: false,
      code: 1,
      message: `cannot start scope with status '${status}' (must be proposed or pending)`,
    };
  }

  if (opts.allowDirty !== true && isDirty(projectRoot, runner)) {
    return {
      ok: false,
      code: 1,
      message: "git tree is dirty -- use --allow-dirty or commit/stash changes",
    };
  }

  const policy = resolvePolicy(projectRoot);
  if ("error" in policy) {
    return { ok: false, code: 2, message: policy.error };
  }
  if (!policy.allowDirectCommitsToDefault && isGitRepo(projectRoot, runner)) {
    const branch = currentBranch(projectRoot, runner);
    const def = defaultBranch(projectRoot, runner);
    if (branch !== null && branch === def) {
      return {
        ok: false,
        code: 1,
        message: `on default branch '${def}' and policy.allowDirectCommitsToDefault is false`,
      };
    }
  }

  let current = scope;
  if (status === "proposed") {
    ref = transitionScope(projectRoot, ref, current, "pending", now);
    appendAudit(
      projectRoot,
      { kind: "scope-start", transition: "proposed->pending", scope: ref.relPath },
      now,
    );
    const reread = readScope(ref.path);
    if (!reread.ok) {
      return { ok: false, code: 2, message: reread.message };
    }
    current = reread.scope;
  }

  ref = transitionScope(projectRoot, ref, current, "running", now);
  appendAudit(
    projectRoot,
    { kind: "scope-start", transition: "pending->running", scope: ref.relPath },
    now,
  );

  return { ok: true, scope: ref.relPath, status: "running" };
}
