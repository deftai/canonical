import type { GhClient, RepoSlug } from "../gh/rest.js";

/**
 * CLEAN evaluation for a single PR (content/scm.md "Merge"):
 *   - required checks terminal-pass on the current head SHA
 *   - review present on this SHA (when reviews exist at all)
 *   - zero open, un-superseded CHANGES_REQUESTED reviews
 *   - branch up to date, closing keyword present (reported, not gated here --
 *     pr:finish enforces those in addition to CLEAN)
 */

export const CLOSING_KEYWORD_RE = /(close[sd]?|fix(e[sd])?|resolve[sd]?)\s+#(\d+)/i;

const OK_CHECK_CONCLUSIONS: ReadonlySet<string> = new Set(["success", "neutral", "skipped"]);

/** Reasons that block CLEAN due to an un-superseded CHANGES_REQUESTED review carry this prefix. */
export const CHANGES_REQUESTED_REASON_PREFIX = "changes-requested:";

export interface CleanResult {
  readonly clean: boolean;
  readonly reasons: readonly string[];
  readonly headSha: string;
  readonly closingKeywordPresent: boolean;
  readonly upToDate: boolean;
}

interface PullRequestPayload {
  readonly head?: { readonly sha?: string; readonly ref?: string };
  readonly base?: { readonly ref?: string };
  readonly draft?: boolean;
  readonly mergeable_state?: string | null;
  readonly body?: string | null;
}

interface CheckRun {
  readonly status: string;
  readonly conclusion: string | null;
  readonly name?: string;
}

interface CheckRunsPayload {
  readonly check_runs?: readonly CheckRun[];
}

interface CombinedStatusPayload {
  readonly state?: string;
  readonly total_count?: number;
}

interface ReviewPayload {
  readonly user?: { readonly login?: string } | null;
  readonly state?: string;
  readonly commit_id?: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

export async function evaluateClean(
  client: GhClient,
  repo: RepoSlug,
  prNumber: number,
): Promise<CleanResult> {
  const base = `/repos/${repo.owner}/${repo.repo}`;
  const pr = asRecord(await client.get(`${base}/pulls/${prNumber}`)) as PullRequestPayload;
  const headSha = pr.head?.sha ?? "";
  const body = pr.body ?? "";
  const closingKeywordPresent = CLOSING_KEYWORD_RE.test(body);
  const upToDate = pr.mergeable_state !== "behind";

  const reasons: string[] = [];

  const checkRunsPayload = asRecord(
    await client.get(`${base}/commits/${headSha}/check-runs`),
  ) as CheckRunsPayload;
  for (const run of checkRunsPayload.check_runs ?? []) {
    if (run.status !== "completed") {
      reasons.push(`check run not completed: ${run.name ?? "unnamed"} (${run.status})`);
    } else if (!OK_CHECK_CONCLUSIONS.has(run.conclusion ?? "")) {
      reasons.push(`check run failed: ${run.name ?? "unnamed"} (${run.conclusion ?? "null"})`);
    }
  }

  const combined = asRecord(
    await client.get(`${base}/commits/${headSha}/status`),
  ) as CombinedStatusPayload;
  const totalCount = combined.total_count ?? 0;
  const combinedOk =
    combined.state === "success" || (combined.state === "pending" && totalCount === 0);
  if (!combinedOk) {
    reasons.push(
      `combined status not clean: state=${combined.state ?? "unknown"} total=${totalCount}`,
    );
  }

  const reviews =
    ((await client.get(`${base}/pulls/${prNumber}/reviews`)) as ReviewPayload[]) ?? [];
  const latestByReviewer = new Map<string, ReviewPayload>();
  for (const review of reviews) {
    const login = review.user?.login;
    if (login === undefined) {
      continue;
    }
    // Reviews are returned in chronological (submission) order; a later entry
    // for the same reviewer -- including a DISMISSED state on the review that
    // was dismissed -- supersedes the earlier one.
    latestByReviewer.set(login, review);
  }
  for (const [login, review] of latestByReviewer) {
    if (review.state === "CHANGES_REQUESTED") {
      reasons.push(`${CHANGES_REQUESTED_REASON_PREFIX} ${login}`);
    }
  }

  if (reviews.length > 0) {
    const hasHeadReview = reviews.some((r) => r.commit_id === headSha);
    if (!hasHeadReview) {
      reasons.push("no review present for current head SHA");
    }
  }

  return {
    clean: reasons.length === 0,
    reasons,
    headSha,
    closingKeywordPresent,
    upToDate,
  };
}
