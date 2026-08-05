import { GhConfigError, type GhSeams, ghClient, resolveRepo } from "../gh/rest.js";
import { defaultBranch, type GitRunner, isAncestorOf, isGitRepo } from "../git/index.js";
import { resolvePolicy } from "../policy/index.js";
import type { DeliveryDisposition, ScopeFile } from "../types/index.js";
import { DELIVERY_DISPOSITIONS } from "../types/index.js";
import { appendAudit } from "../xbrief/audit.js";
import { findScope, readScope, transitionScope } from "../xbrief/brief-io.js";

/**
 * `scope:complete` verb (content/canonical-tasks.md #scope:complete, content/state.md
 * "Story Fields" delivery block). Terminal success: requires delivery evidence
 * for code-bearing (kind: story) scopes and, when the origin issue is still
 * open, best-effort closes it with a PR-linking comment.
 */

function isDeliveryDisposition(value: string): value is DeliveryDisposition {
  return (DELIVERY_DISPOSITIONS as readonly string[]).includes(value);
}

export interface ScopeCompleteOptions {
  /** Identifier resolved via findScope (relative path, filename, or slug fragment). */
  readonly scope: string;
  readonly disposition?: string;
  readonly pr?: string;
  readonly sha?: string;
  readonly now?: Date;
  /** Injectable git seam for tests. */
  readonly runner?: GitRunner;
  /** Injectable gh seams (fetch/env/exec) for tests -- never live network in tests. */
  readonly ghSeams?: GhSeams;
}

export type ScopeCompleteResult =
  | {
      readonly ok: true;
      readonly scope: string;
      readonly status: "completed";
      readonly issueClosed?: boolean;
    }
  | { readonly ok: false; readonly code: 1 | 2; readonly message: string };

const ISSUE_NUMBER_RE = /\/issues\/(\d+)(?:[/?#]|$)/;

async function tryCloseIssue(
  projectRoot: string,
  scope: ScopeFile,
  relPath: string,
  pr: string | undefined,
  seams: GhSeams | undefined,
): Promise<boolean | undefined> {
  const issueRef = scope.references?.find((r) => r.type === "issue");
  if (issueRef === undefined) {
    return undefined;
  }
  const match = ISSUE_NUMBER_RE.exec(issueRef.uri);
  if (match === null || match[1] === undefined) {
    return undefined;
  }
  const issueNumber = match[1];
  try {
    const client = ghClient(seams);
    const repo = resolveRepo(projectRoot, seams);
    // Only close issues that are still open (spec: "if an origin issue exists
    // and is open") -- keeps scope:complete idempotent on the GitHub side.
    const issue = (await client.get(`/repos/${repo.owner}/${repo.repo}/issues/${issueNumber}`)) as {
      state?: string;
    } | null;
    if (issue === null || issue.state !== "open") {
      return undefined;
    }
    const commentBody =
      pr !== undefined ? `Closed via ${pr}` : `Closed by scope completion: ${relPath}`;
    await client.post(`/repos/${repo.owner}/${repo.repo}/issues/${issueNumber}/comments`, {
      body: commentBody,
    });
    await client.patch(`/repos/${repo.owner}/${repo.repo}/issues/${issueNumber}`, {
      state: "closed",
    });
    return true;
  } catch (err) {
    if (err instanceof GhConfigError) {
      process.stderr.write(
        `canon: scope-complete: github not configured -- issue not closed (${err.message})\n`,
      );
    } else {
      process.stderr.write(
        `canon: scope-complete: failed to close issue -- ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
    return false;
  }
}

export async function scopeComplete(
  projectRoot: string,
  opts: ScopeCompleteOptions,
): Promise<ScopeCompleteResult> {
  const now = opts.now ?? new Date();
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
  const ref = found;

  const readResult = readScope(ref.path);
  if (!readResult.ok) {
    return { ok: false, code: 2, message: readResult.message };
  }
  const scope = readResult.scope;
  const codeBearing = scope.kind === "story";

  // Lifecycle gate: complete is active -> completed (content/state.md). A
  // terminal or not-yet-started scope cannot be completed.
  const status = scope.plan.status;
  if (status !== "running" && status !== "blocked") {
    return {
      ok: false,
      code: 1,
      message: `cannot complete '${ref.relPath}': status is '${status}' (must be running or blocked -- start it first)`,
    };
  }

  if (opts.disposition === undefined) {
    if (codeBearing) {
      return {
        ok: false,
        code: 1,
        message:
          "missing delivery evidence: --disposition is required to complete a code-bearing scope (kind: story)",
      };
    }
  } else if (!isDeliveryDisposition(opts.disposition)) {
    return {
      ok: false,
      code: 2,
      message: `--disposition must be one of ${DELIVERY_DISPOSITIONS.join("|")}, got '${opts.disposition}'`,
    };
  }
  const disposition = opts.disposition as DeliveryDisposition | undefined;

  const policy = resolvePolicy(projectRoot);
  if ("error" in policy) {
    return { ok: false, code: 2, message: policy.error };
  }

  let updated: ScopeFile = scope;
  if (disposition !== undefined) {
    const gitAvailable = isGitRepo(projectRoot, opts.runner);
    const branch =
      policy.deliveryBranch ?? (gitAvailable ? defaultBranch(projectRoot, opts.runner) : "main");
    if (disposition === "delivered") {
      // "delivered" is an evidence-bearing claim (content/state.md): require a
      // PR url or merge sha; verify sha ancestry against the delivery branch
      // whenever git can check it.
      if (opts.pr === undefined && opts.sha === undefined) {
        return {
          ok: false,
          code: 1,
          message:
            "missing delivery evidence: disposition 'delivered' requires --pr and/or --sha (merge evidence)",
        };
      }
      if (opts.sha !== undefined && gitAvailable) {
        if (!isAncestorOf(projectRoot, opts.sha, branch, opts.runner)) {
          return {
            ok: false,
            code: 1,
            message: `sha '${opts.sha}' is not an ancestor of delivery branch '${branch}'`,
          };
        }
      } else if (opts.sha === undefined) {
        process.stderr.write(
          "canon: scope-complete: warning -- 'delivered' recorded from --pr only; no sha to verify against the delivery branch\n",
        );
      }
    }
    updated = {
      ...scope,
      delivery: {
        disposition,
        ...(opts.pr !== undefined ? { pr: opts.pr } : {}),
        ...(opts.sha !== undefined ? { sha: opts.sha } : {}),
        branch,
      },
    };
  }

  const newRef = transitionScope(projectRoot, ref, updated, "completed", now);
  appendAudit(
    projectRoot,
    { kind: "scope-complete", scope: newRef.relPath, disposition: disposition ?? null },
    now,
  );

  const issueClosed = await tryCloseIssue(
    projectRoot,
    updated,
    newRef.relPath,
    opts.pr,
    opts.ghSeams,
  );

  return {
    ok: true,
    scope: newRef.relPath,
    status: "completed",
    ...(issueClosed !== undefined ? { issueClosed } : {}),
  };
}
