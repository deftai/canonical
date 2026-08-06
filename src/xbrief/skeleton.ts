import type { ScopeDoc } from "../types/index.js";
import { XBRIEF_VERSION } from "../types/index.js";
import type { ScopeRef } from "./brief-io.js";
import { isoDate, listScopes, normalizeSlug } from "./brief-io.js";

/**
 * `scope:new` -- schema skeleton builder (content/canonical-tasks.md,
 * content/state.md "Scope Files"). Pure: no disk I/O here; the CLI handler
 * owns the write via `writeScope`.
 */

/** `${isoDate()}-${normalizeSlug(title)}.xbrief.json`, per the filename contract. */
export function scopeSkeletonFilename(title: string, now: Date = new Date()): string {
  return `${isoDate(now)}-${normalizeSlug(title)}.xbrief.json`;
}

/** A valid, minimal scope document in status `proposed`, ready to write via `writeScope`. */
export function buildScopeSkeleton(title: string, now: Date = new Date()): ScopeDoc {
  const timestamp = now.toISOString();
  return {
    xBRIEFInfo: { version: XBRIEF_VERSION },
    plan: {
      title,
      status: "proposed",
      created: timestamp,
      updated: timestamp,
      items: [],
      narratives: { Description: "" },
      references: [],
      "x-canonical/kind": "story",
    },
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
