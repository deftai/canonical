import type { GhClient, RepoSlug } from "../gh/rest.js";
import type { ScopeDoc, ScopeReference } from "../types/index.js";
import { withPlan } from "../types/index.js";
import { findScope, readScope, writeScope } from "../xbrief/brief-io.js";

/** Exit codes per content/canonical-tasks.md `issue:sync emit`. */
export type EmitExitCode = 0 | 2;

export interface EmitResult {
  readonly code: EmitExitCode;
  readonly message: string;
  readonly issueNumber?: number;
  readonly created?: boolean;
}

interface IssuePayload {
  readonly number: number;
  readonly html_url: string;
}

function issueNumberFromUri(uri: string): number | undefined {
  const m = /\/issues\/(\d+)\/?$/.exec(uri);
  return m?.[1] !== undefined ? Number(m[1]) : undefined;
}

/**
 * Open or update the GitHub issue tied to a scope
 * (content/canonical-tasks.md `issue:sync emit`): if the scope already
 * carries an issue reference, PATCH that issue's title/body from the scope;
 * otherwise POST a new issue and append the reference + Origin narrative.
 */
export async function emit(
  client: GhClient,
  repo: RepoSlug,
  projectRoot: string,
  scopeId: string,
): Promise<EmitResult> {
  const found = findScope(projectRoot, scopeId);
  if (found === null) {
    return { code: 2, message: `scope not found: ${scopeId}` };
  }
  if ("ambiguous" in found) {
    return {
      code: 2,
      message: `ambiguous scope identifier ${scopeId}: ${found.ambiguous.join(", ")}`,
    };
  }
  const read = readScope(found.path);
  if (!read.ok) {
    return { code: 2, message: read.message };
  }
  const scope = read.scope;
  const title = scope.plan.title;
  const body = scope.plan.narratives?.Description ?? "";
  const base = `/repos/${repo.owner}/${repo.repo}`;

  try {
    const existingRef = (scope.plan.references ?? []).find(
      (r) => r.type === "x-xbrief/github-issue",
    );
    if (existingRef !== undefined) {
      const issueNumber = issueNumberFromUri(existingRef.uri);
      if (issueNumber === undefined) {
        return { code: 2, message: `cannot parse issue number from reference: ${existingRef.uri}` };
      }
      await client.patch(`${base}/issues/${issueNumber}`, { title, body });
      return {
        code: 0,
        issueNumber,
        created: false,
        message: `updated issue #${issueNumber} from ${found.relPath}`,
      };
    }

    const createdIssue = (await client.post(`${base}/issues`, { title, body })) as IssuePayload;
    const newRef: ScopeReference = {
      uri: createdIssue.html_url,
      type: "x-xbrief/github-issue",
      title,
      "x-canonical/trust": "external",
    };
    const updated: ScopeDoc = withPlan(scope, {
      references: [...(scope.plan.references ?? []), newRef],
      narratives: {
        ...scope.plan.narratives,
        Origin: `Emitted to issue #${createdIssue.number}`,
      },
    });
    writeScope(projectRoot, found.relPath, updated);
    return {
      code: 0,
      issueNumber: createdIssue.number,
      created: true,
      message: `created issue #${createdIssue.number} from ${found.relPath}`,
    };
  } catch (err) {
    return { code: 2, message: `API error: ${err instanceof Error ? err.message : String(err)}` };
  }
}
