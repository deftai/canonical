import type { ScopeFile } from "@canonpack/types";
import { isoDate, listScopes, normalizeSlug, readScope, writeScope } from "../briefs/brief-io.js";
import type { GhClient, RepoSlug } from "../gh/rest.js";

/** Exit codes per content/canonical-tasks.md `issue:sync ingest`. */
export type IngestExitCode = 0 | 1 | 2;

export interface IngestOptions {
  /** Ingest a single issue by number. Mutually exclusive with `all`. */
  readonly number?: number;
  /** Ingest every open issue (optionally filtered by `label`). */
  readonly all?: boolean;
  readonly label?: string;
  /** Compute planned writes without touching disk. */
  readonly dryRun?: boolean;
}

export interface IngestSkip {
  readonly issueNumber: number;
  readonly reason: string;
}

export interface IngestResult {
  readonly code: IngestExitCode;
  readonly message: string;
  readonly dryRun: boolean;
  readonly written: readonly string[];
  readonly skipped: readonly IngestSkip[];
}

interface IssuePayload {
  readonly number: number;
  readonly title: string;
  readonly body?: string | null;
  readonly html_url: string;
  readonly pull_request?: unknown;
}

function extractChecklist(body: string): string {
  const lines = body.split(/\r?\n/);
  const items: string[] = [];
  const re = /^\s*[-*]\s*\[[ xX]\]\s*(.+)$/;
  for (const line of lines) {
    const m = re.exec(line);
    if (m?.[1] !== undefined) {
      items.push(m[1].trim());
    }
  }
  return items.join("\n");
}

function existingIssueUris(projectRoot: string): ReadonlySet<string> {
  const uris = new Set<string>();
  for (const ref of listScopes(projectRoot)) {
    const read = readScope(ref.path);
    if (!read.ok) {
      continue;
    }
    for (const reference of read.scope.references ?? []) {
      if (reference.type === "issue") {
        uris.add(reference.uri);
      }
    }
  }
  return uris;
}

function buildScope(issue: IssuePayload, now: Date): ScopeFile {
  const body = issue.body ?? "";
  const checklist = extractChecklist(body);
  return {
    title: issue.title,
    kind: "story",
    plan: { status: "proposed", created: now.toISOString(), updated: now.toISOString() },
    narratives: {
      Description: body,
      ...(checklist !== "" ? { Acceptance: checklist } : {}),
      Origin: `Ingested from issue #${issue.number}`,
    },
    items: [],
    references: [{ uri: issue.html_url, type: "issue", title: issue.title, trust: "external" }],
  };
}

/**
 * Ingest one or all open GitHub issues as `proposed/` scopes
 * (content/state.md "Origins & Trust"). Skips -- not errors -- an issue
 * already referenced by an existing scope.
 */
export async function ingest(
  client: GhClient,
  repo: RepoSlug,
  projectRoot: string,
  opts: IngestOptions,
  now: Date = new Date(),
): Promise<IngestResult> {
  const base = `/repos/${repo.owner}/${repo.repo}`;
  let issues: IssuePayload[];
  try {
    if (opts.number !== undefined) {
      const issue = (await client.get(`${base}/issues/${opts.number}`)) as IssuePayload;
      issues = [issue];
    } else {
      const qs =
        opts.label !== undefined
          ? `?state=open&per_page=100&labels=${encodeURIComponent(opts.label)}`
          : "?state=open&per_page=100";
      const list = (await client.get(`${base}/issues${qs}`)) as IssuePayload[];
      issues = (list ?? []).filter((i) => i.pull_request === undefined);
    }
  } catch (err) {
    return {
      code: 2,
      dryRun: opts.dryRun ?? false,
      written: [],
      skipped: [],
      message: `API error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const known = existingIssueUris(projectRoot);
  const written: string[] = [];
  const skipped: IngestSkip[] = [];

  for (const issue of issues) {
    if (known.has(issue.html_url)) {
      skipped.push({ issueNumber: issue.number, reason: `already ingested: ${issue.html_url}` });
      continue;
    }
    const scope = buildScope(issue, now);
    // An all-punctuation issue title normalizes to an empty slug; fall back so
    // the filename contract holds.
    const slug = normalizeSlug(issue.title) || "untitled";
    const filename = `${isoDate(now)}-${slug}-issue-${issue.number}.json`;
    const relPath = `briefs/proposed/${filename}`;
    if (opts.dryRun !== true) {
      writeScope(projectRoot, relPath, scope);
    }
    written.push(relPath);
  }

  const dryRun = opts.dryRun ?? false;
  const code: IngestExitCode = written.length > 0 ? 0 : 1;
  const summary =
    written.length > 0
      ? `${dryRun ? "would write" : "wrote"} ${written.length} scope(s)`
      : `nothing to ingest (${skipped.length} skipped)`;
  return { code, dryRun, written, skipped, message: summary };
}
