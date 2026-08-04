import type { GhSeams, RepoSlug } from "../gh/rest.js";
import { ghClient, resolveToken } from "../gh/rest.js";
import { resolvePolicy } from "../policy/index.js";
import { CLOSING_KEYWORD_RE, evaluateClean } from "./clean.js";

/** Exit codes per content/canonical-tasks.md `pr:finish`. */
export type FinishExitCode = 0 | 1 | 2;

export interface FinishResult {
  readonly code: FinishExitCode;
  readonly message: string;
  readonly merged: boolean;
  readonly issueClosed?: boolean;
  readonly issueNumber?: number;
}

interface PullRequestPayload {
  readonly head?: { readonly ref?: string };
  readonly body?: string | null;
}

interface IssuePayload {
  readonly state?: string;
}

const API_BASE = "https://api.github.com";

/** DELETE isn't exposed on GhClient; use the same injectable fetch seam directly. */
async function deleteRef(seams: GhSeams, repo: RepoSlug, branch: string): Promise<void> {
  const fetchFn = seams.fetchFn ?? fetch;
  const token = resolveToken(seams);
  await fetchFn(
    `${API_BASE}/repos/${repo.owner}/${repo.repo}/git/refs/heads/${encodeURIComponent(branch)}`,
    {
      method: "DELETE",
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "user-agent": "canonpack",
        "x-github-api-version": "2022-11-28",
      },
    },
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

/**
 * Fail-closed merge (content/scm.md "Merge"): verify CLEAN + up to date +
 * closing keyword, respect `policy.requireHumanMerge` (hand off instead of
 * merging), else squash-merge + delete branch + verify the closing-keyword
 * issue actually closed (close manually with a linking comment if not).
 */
export async function finishPr(
  seams: GhSeams,
  repo: RepoSlug,
  prNumber: number,
  projectRoot: string,
): Promise<FinishResult> {
  const client = ghClient(seams);
  const base = `/repos/${repo.owner}/${repo.repo}`;

  let clean: Awaited<ReturnType<typeof evaluateClean>>;
  try {
    clean = await evaluateClean(client, repo, prNumber);
  } catch (err) {
    return {
      code: 2,
      merged: false,
      message: `API error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const problems: string[] = [];
  if (!clean.clean) {
    problems.push(`not CLEAN: ${clean.reasons.join("; ") || "unknown"}`);
  }
  if (!clean.upToDate) {
    problems.push("branch is not up to date with base");
  }
  if (!clean.closingKeywordPresent) {
    problems.push("no closing keyword (closes/fixes/resolves #N) in PR body");
  }
  if (problems.length > 0) {
    return { code: 1, merged: false, message: problems.join(" | ") };
  }

  const policy = resolvePolicy(projectRoot);
  if ("error" in policy) {
    return { code: 2, merged: false, message: policy.error };
  }
  if (policy.requireHumanMerge) {
    return {
      code: 1,
      merged: false,
      message: `policy.requireHumanMerge is true -- PR #${prNumber} is CLEAN and ready; hand off to a human to merge`,
    };
  }

  let pr: PullRequestPayload;
  try {
    pr = asRecord(await client.get(`${base}/pulls/${prNumber}`)) as PullRequestPayload;
  } catch (err) {
    return {
      code: 2,
      merged: false,
      message: `API error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  const headBranch = pr.head?.ref;
  const body = pr.body ?? "";

  try {
    await client.put(`${base}/pulls/${prNumber}/merge`, { merge_method: "squash" });
  } catch (err) {
    return {
      code: 2,
      merged: false,
      message: `merge failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (headBranch !== undefined) {
    try {
      await deleteRef(seams, repo, headBranch);
    } catch {
      // tolerate failure -- branch deletion is best-effort
    }
  }

  const match = CLOSING_KEYWORD_RE.exec(body);
  const issueNumber = match?.[3] !== undefined ? Number(match[3]) : undefined;
  if (issueNumber === undefined) {
    return {
      code: 0,
      merged: true,
      message: `PR #${prNumber} merged (squash); no closing issue number found to verify`,
    };
  }

  try {
    const issue = asRecord(await client.get(`${base}/issues/${issueNumber}`)) as IssuePayload;
    if (issue.state === "closed") {
      return {
        code: 0,
        merged: true,
        issueClosed: true,
        issueNumber,
        message: `PR #${prNumber} merged (squash); issue #${issueNumber} closed`,
      };
    }
    await client.post(`${base}/issues/${issueNumber}/comments`, {
      body: `Closed by PR #${prNumber}`,
    });
    await client.patch(`${base}/issues/${issueNumber}`, { state: "closed" });
    return {
      code: 0,
      merged: true,
      issueClosed: true,
      issueNumber,
      message: `PR #${prNumber} merged (squash); issue #${issueNumber} closed manually`,
    };
  } catch (err) {
    return {
      code: 2,
      merged: true,
      issueNumber,
      message: `merged but failed to verify/close issue #${issueNumber}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
