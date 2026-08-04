import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { appendAudit } from "../briefs/audit.js";
import { findScope, listScopes, readScope, transitionScope } from "../briefs/brief-io.js";
import { atomicWriteJson } from "../fs/contained-write.js";
import { currentBranch } from "../git/index.js";
import type { ScopeFile } from "../types/index.js";

/**
 * `swarm:run` -- cohort prep or finalize, never spawns (content/canonical-tasks.md
 * `swarm:run`, content/multi-agent.md "Isolation & Readiness"). Two modes:
 *  - "stories": readiness-check the given story paths and, on pass, emit
 *    `.canonical/cache/launch-manifest.json`.
 *  - "finalize": read a manifest and `scope:complete` (via brief-io
 *    transitionScope) every listed story still sitting in `active/`.
 *
 * Deliberately does not import from core/scope or core/triage -- those are
 * owned by another stream; every state mutation here goes through the
 * brief-io primitives directly.
 */

export const LAUNCH_MANIFEST_REL = ".canonical/cache/launch-manifest.json";

export interface SwarmViolation {
  readonly story: string;
  readonly reason: string;
}

export interface LaunchManifestStory {
  readonly story_id: string;
  readonly story_path: string;
  readonly worktree_path: string;
  readonly base_branch: string;
}

export interface LaunchManifest {
  readonly created: string;
  readonly stories: readonly LaunchManifestStory[];
}

export interface SwarmRunStoriesOptions {
  readonly mode: "stories";
  readonly storyPaths: readonly string[];
  readonly now?: Date;
}

export interface SwarmRunFinalizeOptions {
  readonly mode: "finalize";
  readonly manifestPath: string;
  readonly now?: Date;
}

export type SwarmRunOptions = SwarmRunStoriesOptions | SwarmRunFinalizeOptions;

export interface SwarmRunStoriesResult {
  readonly mode: "stories";
  readonly code: 0 | 1 | 2;
  readonly message?: string;
  readonly violations: readonly SwarmViolation[];
  readonly manifest?: LaunchManifest;
}

export interface SwarmRunFinalizeResult {
  readonly mode: "finalize";
  readonly code: 0 | 2;
  readonly message?: string;
  readonly finalized: readonly string[];
}

export type SwarmRunResult = SwarmRunStoriesResult | SwarmRunFinalizeResult;

/**
 * Reduce a file_scope entry to the literal path prefix it claims. A glob
 * (`*` anywhere) claims everything under the path up to its first wildcard
 * segment -- `src/**` claims all of `src/`, so it overlaps any entry that
 * shares that prefix.
 */
function literalPrefix(entry: string): string {
  const star = entry.indexOf("*");
  if (star === -1) {
    return entry;
  }
  const prefix = entry.slice(0, star);
  const lastSlash = prefix.lastIndexOf("/");
  return lastSlash === -1 ? "" : prefix.slice(0, lastSlash);
}

function pathOverlaps(a: string, b: string): boolean {
  const la = literalPrefix(a);
  const lb = literalPrefix(b);
  // A wildcard reducing to the empty prefix claims the whole tree.
  if ((a.includes("*") && la === "") || (b.includes("*") && lb === "")) {
    return true;
  }
  if (la === lb) {
    return true;
  }
  const aDir = la.endsWith("/") ? la : `${la}/`;
  const bDir = lb.endsWith("/") ? lb : `${lb}/`;
  return lb.startsWith(aDir) || la.startsWith(bDir);
}

interface ResolvedStory {
  readonly identifier: string;
  readonly relPath: string;
  readonly filename: string;
  readonly scope: ScopeFile;
}

export function swarmRun(
  projectRoot: string,
  options: SwarmRunStoriesOptions,
): SwarmRunStoriesResult;
export function swarmRun(
  projectRoot: string,
  options: SwarmRunFinalizeOptions,
): SwarmRunFinalizeResult;
export function swarmRun(projectRoot: string, options: SwarmRunOptions): SwarmRunResult {
  if (options.mode === "finalize") {
    return runFinalize(projectRoot, options);
  }
  return runReadiness(projectRoot, options);
}

function runReadiness(projectRoot: string, options: SwarmRunStoriesOptions): SwarmRunStoriesResult {
  if (options.storyPaths.length === 0) {
    return {
      mode: "stories",
      code: 2,
      message: "swarm:run --stories requires at least one story path",
      violations: [],
    };
  }

  const resolved: ResolvedStory[] = [];
  for (const identifier of options.storyPaths) {
    const found = findScope(projectRoot, identifier);
    if (found === null) {
      return {
        mode: "stories",
        code: 2,
        message: `scope not found: ${identifier}`,
        violations: [],
      };
    }
    if ("ambiguous" in found) {
      return {
        mode: "stories",
        code: 2,
        message: `ambiguous scope identifier ${identifier}: ${found.ambiguous.join(", ")}`,
        violations: [],
      };
    }
    const read = readScope(found.path);
    if (!read.ok) {
      return { mode: "stories", code: 2, message: read.message, violations: [] };
    }
    resolved.push({
      identifier,
      relPath: found.relPath,
      filename: found.filename,
      scope: read.scope,
    });
  }

  const violations: SwarmViolation[] = [];
  for (const story of resolved) {
    const label = story.relPath;
    if (story.scope.kind !== "story") {
      violations.push({ story: label, reason: `kind must be "story", got "${story.scope.kind}"` });
    }
    const swarm = story.scope.swarm;
    const fileScope = swarm?.file_scope ?? [];
    const verifyCommands = swarm?.verify_commands ?? [];
    if (fileScope.length === 0) {
      violations.push({ story: label, reason: "swarm.file_scope is empty or missing" });
    }
    if (verifyCommands.length === 0) {
      violations.push({ story: label, reason: "swarm.verify_commands is empty or missing" });
    }
    const itemCount = story.scope.items?.length ?? 0;
    if (itemCount < 2 || itemCount > 5) {
      violations.push({
        story: label,
        reason: `expected 2-5 acceptance items, found ${itemCount}`,
      });
    }
  }

  for (let i = 0; i < resolved.length; i++) {
    for (let j = i + 1; j < resolved.length; j++) {
      const a = resolved[i];
      const b = resolved[j];
      if (a === undefined || b === undefined) {
        continue;
      }
      const aScope = a.scope.swarm?.file_scope ?? [];
      const bScope = b.scope.swarm?.file_scope ?? [];
      for (const pa of aScope) {
        for (const pb of bScope) {
          if (pathOverlaps(pa, pb)) {
            violations.push({
              story: a.relPath,
              reason: `file_scope "${pa}" overlaps "${pb}" in ${b.relPath}`,
            });
            violations.push({
              story: b.relPath,
              reason: `file_scope "${pb}" overlaps "${pa}" in ${a.relPath}`,
            });
          }
        }
      }
    }
  }

  if (violations.length > 0) {
    return { mode: "stories", code: 1, violations };
  }

  const now = options.now ?? new Date();
  const base = currentBranch(projectRoot) ?? "main";
  const manifest: LaunchManifest = {
    created: now.toISOString(),
    stories: resolved.map((s) => ({
      story_id: s.filename,
      story_path: s.relPath,
      worktree_path: `.scratch/worktrees/${s.filename.replace(/\.json$/, "")}`,
      base_branch: base,
    })),
  };
  atomicWriteJson(projectRoot, LAUNCH_MANIFEST_REL, manifest);
  return { mode: "stories", code: 0, violations: [], manifest };
}

function runFinalize(
  projectRoot: string,
  options: SwarmRunFinalizeOptions,
): SwarmRunFinalizeResult {
  const manifestAbs = isAbsolute(options.manifestPath)
    ? options.manifestPath
    : join(projectRoot, options.manifestPath);
  if (!existsSync(manifestAbs)) {
    return {
      mode: "finalize",
      code: 2,
      message: `manifest not found: ${manifestAbs}`,
      finalized: [],
    };
  }
  let raw: string;
  try {
    raw = readFileSync(manifestAbs, "utf8");
  } catch (err) {
    return {
      mode: "finalize",
      code: 2,
      message: `cannot read manifest: ${err instanceof Error ? err.message : String(err)}`,
      finalized: [],
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return {
      mode: "finalize",
      code: 2,
      message: `manifest is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      finalized: [],
    };
  }
  if (
    parsed === null ||
    typeof parsed !== "object" ||
    !Array.isArray((parsed as { stories?: unknown }).stories)
  ) {
    return {
      mode: "finalize",
      code: 2,
      message: "manifest is missing a stories[] array",
      finalized: [],
    };
  }
  const stories = (parsed as { stories: readonly Record<string, unknown>[] }).stories;

  const now = options.now ?? new Date();
  const finalized: string[] = [];
  const skipped: string[] = [];
  const allScopes = listScopes(projectRoot);
  for (const entry of stories) {
    const storyId = entry.story_id;
    if (typeof storyId !== "string") {
      skipped.push(`(malformed manifest entry: missing story_id)`);
      continue;
    }
    const ref = allScopes.find((s) => s.filename === storyId);
    if (ref === undefined || ref.folder !== "active") {
      skipped.push(`${storyId} (not in active/)`);
      continue;
    }
    const read = readScope(ref.path);
    if (!read.ok) {
      skipped.push(`${storyId} (unreadable: ${read.message})`);
      continue;
    }
    // Finalize is post-merge scope completion: record delivery evidence from
    // the manifest before transitioning (content/state.md forbids completed
    // code work with no delivery block).
    const baseBranch = typeof entry.base_branch === "string" ? entry.base_branch : "main";
    const withDelivery = {
      ...read.scope,
      delivery: { disposition: "delivered" as const, branch: baseBranch },
    };
    const newRef = transitionScope(projectRoot, ref, withDelivery, "completed", now);
    appendAudit(projectRoot, { kind: "swarm-finalize", scope: newRef.relPath }, now);
    finalized.push(newRef.relPath);
  }
  const message =
    skipped.length > 0
      ? `finalized ${finalized.length}, skipped ${skipped.length}: ${skipped.join("; ")}`
      : undefined;
  return { mode: "finalize", code: 0, finalized, ...(message !== undefined ? { message } : {}) };
}
