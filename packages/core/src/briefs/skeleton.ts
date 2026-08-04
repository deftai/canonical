import type { ScopeFile } from "@canonpack/types";
import type { ScopeRef } from "./brief-io.js";
import { isoDate, listScopes, normalizeSlug } from "./brief-io.js";

/**
 * `scope:new` -- schema skeleton builder (content/canonical-tasks.md,
 * content/state.md "Scope Files"). Pure: no disk I/O here; the CLI handler
 * owns the write via `writeScope`.
 */

/** `${isoDate()}-${normalizeSlug(title)}.json`, per the filename contract. */
export function scopeSkeletonFilename(title: string, now: Date = new Date()): string {
  return `${isoDate(now)}-${normalizeSlug(title)}.json`;
}

/** A valid, minimal ScopeFile in status `proposed`, ready to write via `writeScope`. */
export function buildScopeSkeleton(title: string, now: Date = new Date()): ScopeFile {
  const timestamp = now.toISOString();
  return {
    title,
    kind: "story",
    plan: { status: "proposed", created: timestamp, updated: timestamp },
    narratives: { Description: "" },
    items: [],
    references: [],
  };
}

/**
 * Find an existing scope file with the same filename anywhere in the
 * lifecycle tree (filenames are immutable identifiers once created --
 * content/state.md: "creation date immutable"). Returns null when clear.
 */
export function findScopeFilenameCollision(projectRoot: string, filename: string): ScopeRef | null {
  return listScopes(projectRoot).find((ref) => ref.filename === filename) ?? null;
}
