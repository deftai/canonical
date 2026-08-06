import type { GhClient, RepoSlug } from "../gh/rest.js";
import { listScopes, readScope } from "../xbrief/brief-io.js";

/** Exit codes per content/canonical-tasks.md `issue:sync reconcile`. */
export type ReconcileExitCode = 0 | 1 | 2;

export type ReconcileFindingKind = "closed-issue-open-scope" | "orphan-open-issue" | "title-drift";

export interface ReconcileFinding {
  readonly kind: ReconcileFindingKind;
  readonly message: string;
  readonly scopePath?: string;
  readonly issueNumber?: number;
}

export interface ReconcileResult {
  readonly code: ReconcileExitCode;
  readonly message: string;
  readonly findings: readonly ReconcileFinding[];
}

interface IssuePayload {
  readonly number: number;
  readonly title: string;
  readonly state: string;
  readonly pull_request?: unknown;
}

const NON_TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  "proposed",
  "pending",
  "running",
  "blocked",
]);

function issueNumberFromUri(uri: string): number | undefined {
  const m = /\/issues\/(\d+)\/?$/.exec(uri);
  return m?.[1] !== undefined ? Number(m[1]) : undefined;
}

/**
 * Read-only origin<->scope drift report (content/canonical-tasks.md
 * `issue:sync reconcile`): externally-closed issues with non-terminal
 * scopes, open issues with no scope, and origin issues whose title changed.
 */
export async function reconcile(
  client: GhClient,
  repo: RepoSlug,
  projectRoot: string,
): Promise<ReconcileResult> {
  const base = `/repos/${repo.owner}/${repo.repo}`;
  const scopeRefs: {
    readonly path: string;
    readonly issueNumber: number;
    readonly title?: string;
    readonly status: string;
  }[] = [];

  for (const ref of listScopes(projectRoot)) {
    const read = readScope(ref.path);
    if (!read.ok) {
      continue;
    }
    const issueRef = (read.scope.plan?.references ?? []).find(
      (r) => r.type === "x-xbrief/github-issue",
    );
    if (issueRef === undefined) {
      continue;
    }
    const issueNumber = issueNumberFromUri(issueRef.uri);
    if (issueNumber === undefined) {
      continue;
    }
    scopeRefs.push({
      path: ref.relPath,
      issueNumber,
      title: issueRef.title,
      status: read.scope.plan?.status ?? "",
    });
  }

  let openIssues: IssuePayload[];
  try {
    openIssues =
      ((await client.get(`${base}/issues?state=open&per_page=100`)) as IssuePayload[]) ?? [];
    openIssues = openIssues.filter((i) => i.pull_request === undefined);
  } catch (err) {
    return {
      code: 2,
      findings: [],
      message: `API error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const findings: ReconcileFinding[] = [];
  const scopedIssueNumbers = new Set(scopeRefs.map((s) => s.issueNumber));

  for (const issue of openIssues) {
    if (!scopedIssueNumbers.has(issue.number)) {
      findings.push({
        kind: "orphan-open-issue",
        issueNumber: issue.number,
        message: `open issue #${issue.number} ("${issue.title}") has no scope`,
      });
    }
  }

  for (const scopeRef of scopeRefs) {
    let issue: IssuePayload;
    try {
      issue = (await client.get(`${base}/issues/${scopeRef.issueNumber}`)) as IssuePayload;
    } catch (err) {
      return {
        code: 2,
        findings: [],
        message: `API error: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    if (issue.state === "closed" && NON_TERMINAL_STATUSES.has(scopeRef.status)) {
      findings.push({
        kind: "closed-issue-open-scope",
        scopePath: scopeRef.path,
        issueNumber: scopeRef.issueNumber,
        message: `${scopeRef.path} is "${scopeRef.status}" but issue #${scopeRef.issueNumber} is closed`,
      });
    }
    if (scopeRef.title !== undefined && issue.title !== scopeRef.title) {
      findings.push({
        kind: "title-drift",
        scopePath: scopeRef.path,
        issueNumber: scopeRef.issueNumber,
        message: `${scopeRef.path} reference title "${scopeRef.title}" != issue #${scopeRef.issueNumber} title "${issue.title}"`,
      });
    }
  }

  const code: ReconcileExitCode = findings.length > 0 ? 1 : 0;
  return {
    code,
    findings,
    message: findings.length > 0 ? `${findings.length} drift finding(s)` : "no drift",
  };
}
