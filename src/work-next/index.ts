import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ScopeFile, ScopeStatus } from "../types/index.js";
import { listScopes, readScope, xbriefRoot } from "../xbrief/brief-io.js";

/**
 * `work:next` -- pure ranking logic (content/canonical-tasks.md):
 *  1. `xbrief/plan.json` `sequence: string[]` (rel-paths) -> first entry
 *     whose scope status is not terminal.
 *  2. else `xbrief/pending/*.json` ranked dependencies-satisfied-first,
 *     then oldest `plan.created`.
 *  3. else empty.
 *
 * Never touches disk beyond reads; never throws -- corrupt JSON anywhere
 * surfaces as a `{ kind: "error" }` result (maps to exit 2 in the CLI).
 */

const TERMINAL_STATUSES: readonly ScopeStatus[] = ["completed", "failed", "cancelled"];

export interface WorkNextItem {
  readonly relPath: string;
  readonly title: string;
  readonly status: ScopeStatus;
}

export type WorkNextResult =
  | { readonly kind: "found"; readonly item: WorkNextItem }
  | { readonly kind: "empty" }
  | { readonly kind: "error"; readonly message: string };

function planPath(projectRoot: string): string {
  return join(xbriefRoot(projectRoot), "plan.json");
}

function toItem(relPath: string, scope: ScopeFile): WorkNextItem {
  return { relPath, title: scope.title, status: scope.plan.status };
}

export function workNext(projectRoot: string): WorkNextResult {
  const planFile = planPath(projectRoot);
  if (existsSync(planFile)) {
    const planRead = readScope(planFile);
    if (!planRead.ok) {
      return { kind: "error", message: planRead.message };
    }
    const plan = planRead.scope as unknown as { readonly sequence?: unknown };
    if (plan.sequence !== undefined) {
      return resolveSequence(projectRoot, planFile, plan.sequence);
    }
  }
  return rankPending(projectRoot);
}

function resolveSequence(projectRoot: string, planFile: string, sequence: unknown): WorkNextResult {
  if (!Array.isArray(sequence) || !sequence.every((v) => typeof v === "string")) {
    return { kind: "error", message: `${planFile}: plan.sequence must be an array of strings` };
  }
  for (const relPath of sequence as readonly string[]) {
    const abs = join(projectRoot, relPath);
    const scopeRead = readScope(abs);
    if (!scopeRead.ok) {
      return { kind: "error", message: scopeRead.message };
    }
    if (!TERMINAL_STATUSES.includes(scopeRead.scope.plan.status)) {
      return { kind: "found", item: toItem(relPath, scopeRead.scope) };
    }
  }
  return { kind: "empty" };
}

interface Candidate {
  readonly relPath: string;
  readonly scope: ScopeFile;
  readonly satisfied: boolean;
}

function rankPending(projectRoot: string): WorkNextResult {
  const all = listScopes(projectRoot);
  const pendingRefs = all.filter((ref) => ref.folder === "pending");
  if (pendingRefs.length === 0) {
    return { kind: "empty" };
  }

  const byFilename = new Map(all.map((ref) => [ref.filename, ref] as const));
  const candidates: Candidate[] = [];

  for (const ref of pendingRefs) {
    const read = readScope(ref.path);
    if (!read.ok) {
      return { kind: "error", message: read.message };
    }
    const deps = read.scope.dependencies ?? [];
    let satisfied = true;
    for (const dep of deps) {
      const depRef = byFilename.get(dep);
      if (depRef === undefined) {
        satisfied = false;
        continue;
      }
      const depRead = readScope(depRef.path);
      if (!depRead.ok) {
        return { kind: "error", message: depRead.message };
      }
      if (depRead.scope.plan.status !== "completed") {
        satisfied = false;
      }
    }
    candidates.push({ relPath: ref.relPath, scope: read.scope, satisfied });
  }

  candidates.sort((a, b) => {
    if (a.satisfied !== b.satisfied) {
      return a.satisfied ? -1 : 1;
    }
    const aCreated = a.scope.plan.created;
    const bCreated = b.scope.plan.created;
    if (aCreated < bCreated) {
      return -1;
    }
    if (aCreated > bCreated) {
      return 1;
    }
    return 0;
  });

  const first = candidates[0];
  if (first === undefined) {
    return { kind: "empty" };
  }
  return { kind: "found", item: toItem(first.relPath, first.scope) };
}
