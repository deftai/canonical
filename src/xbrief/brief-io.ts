import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import { atomicWriteText } from "../fs/contained-write.js";
import type { LifecycleFolder, ScopeDoc, ScopeStatus } from "../types/index.js";
import {
  LIFECYCLE_FOLDERS,
  SCOPE_FILENAME_RE,
  SCOPE_SLUG_MAX_LENGTH,
  STATUS_FOLDER_MAP,
  withPlan,
} from "../types/index.js";

/** xbrief/ path helpers + scope document read/write. Reads never throw on bad JSON -- they return result objects. */

export function xbriefRoot(projectRoot: string): string {
  return join(projectRoot, "xbrief");
}

export function lifecycleDir(projectRoot: string, folder: LifecycleFolder): string {
  return join(xbriefRoot(projectRoot), folder);
}

export function xbriefExist(projectRoot: string): boolean {
  return existsSync(xbriefRoot(projectRoot));
}

/**
 * Canonical xBRIEF serialization: recursively alphabetized keys, 2-space
 * indent, trailing newline (the reference library's `canonical: true` form).
 * Deterministic output keeps git diffs limited to real changes.
 */
export function canonicalStringify(value: unknown): string {
  return `${JSON.stringify(sortJsonValue(value), null, 2)}\n`;
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue);
  }
  if (typeof value === "object" && value !== null) {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = sortJsonValue((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

export interface ScopeRef {
  /** Absolute path. */
  readonly path: string;
  /** Path relative to project root, POSIX separators (e.g. "xbrief/active/2026-08-04-x.xbrief.json"). */
  readonly relPath: string;
  readonly folder: LifecycleFolder;
  readonly filename: string;
}

export type ReadScopeResult =
  | { readonly ok: true; readonly scope: ScopeDoc }
  | { readonly ok: false; readonly message: string };

export function readScope(path: string): ReadScopeResult {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    return { ok: false, message: `cannot read ${path}: ${(err as Error).message}` };
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { ok: false, message: `${path}: not a JSON object` };
    }
    return { ok: true, scope: parsed as ScopeDoc };
  } catch (err) {
    return { ok: false, message: `${path}: invalid JSON (${(err as Error).message})` };
  }
}

/** Enumerate every scope file across all lifecycle folders. */
export function listScopes(projectRoot: string): readonly ScopeRef[] {
  const out: ScopeRef[] = [];
  for (const folder of LIFECYCLE_FOLDERS) {
    const dir = lifecycleDir(projectRoot, folder);
    if (!existsSync(dir)) {
      continue;
    }
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries.sort()) {
      if (!name.endsWith(".json")) {
        continue;
      }
      out.push({
        path: join(dir, name),
        relPath: `xbrief/${folder}/${name}`,
        folder,
        filename: name,
      });
    }
  }
  return out;
}

/**
 * Resolve a user-supplied scope identifier (relative path, filename, or slug
 * fragment) to a ScopeRef. Returns null when not found, or an error message
 * string when ambiguous.
 */
export function findScope(
  projectRoot: string,
  identifier: string,
): ScopeRef | null | { readonly ambiguous: readonly string[] } {
  const all = listScopes(projectRoot);
  const base = basename(identifier);
  const exact = all.filter((s) => s.relPath === identifier || s.filename === base);
  if (exact.length === 1) {
    const first = exact[0];
    if (first !== undefined) {
      return first;
    }
  }
  if (exact.length > 1) {
    return { ambiguous: exact.map((s) => s.relPath) };
  }
  const fuzzy = all.filter((s) => s.filename.includes(identifier));
  if (fuzzy.length === 1) {
    const first = fuzzy[0];
    if (first !== undefined) {
      return first;
    }
  }
  if (fuzzy.length > 1) {
    return { ambiguous: fuzzy.map((s) => s.relPath) };
  }
  return null;
}

export function isValidScopeFilename(name: string): boolean {
  const m = SCOPE_FILENAME_RE.exec(name);
  if (m === null) {
    return false;
  }
  const slug = m[4];
  return slug !== undefined && slug.length <= 80;
}

/** Write scope JSON in place (atomic, canonical serialization). Target expressed relative to project root. */
export function writeScope(projectRoot: string, relPath: string, scope: ScopeDoc): void {
  atomicWriteText(projectRoot, relPath, canonicalStringify(scope));
}

/**
 * Move a scope file to the folder matching `newStatus` and update
 * plan.status + plan.updated in one operation. Returns the new ScopeRef.
 */
export function transitionScope(
  projectRoot: string,
  ref: ScopeRef,
  scope: ScopeDoc,
  newStatus: ScopeStatus,
  now: Date = new Date(),
): ScopeRef {
  const targetFolder = STATUS_FOLDER_MAP[newStatus];
  const updated = withPlan(scope, { status: newStatus, updated: now.toISOString() });
  const targetRel = `xbrief/${targetFolder}/${ref.filename}`;
  // Write the updated brief to the TARGET path first (writeScope mkdirs the
  // folder), then remove the source. Worst case on a crash is a duplicate file
  // (state:validate flags it) -- never a folder/status mismatch or a lost brief.
  writeScope(projectRoot, targetRel, updated);
  if (targetFolder !== ref.folder) {
    rmSync(ref.path, { force: true });
  }
  return {
    path: join(lifecycleDir(projectRoot, targetFolder), ref.filename),
    relPath: targetRel,
    folder: targetFolder,
    filename: ref.filename,
  };
}

/**
 * Normalize a title to a slug, reserving `suffix.length` of the 80-char budget
 * so `${slug}${suffix}` stays <=80. Truncates at a hyphen boundary (no mid-token
 * fragment). `suffix` is not appended -- callers compose it.
 */
export function normalizeSlugWithReserve(title: string, suffix: string): string {
  const maxLen = Math.max(0, SCOPE_SLUG_MAX_LENGTH - suffix.length);
  let slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
  if (slug.length <= maxLen) {
    return slug;
  }
  slug = slug.slice(0, maxLen);
  const lastHyphen = slug.lastIndexOf("-");
  if (lastHyphen > 0) {
    slug = slug.slice(0, lastHyphen);
  }
  return slug.replace(/-+$/, "");
}

/** Normalize a title to the canonical slug: lowercase [a-z0-9-], <=80 chars. */
export function normalizeSlug(title: string): string {
  return normalizeSlugWithReserve(title, "");
}

/** Today's date as YYYY-MM-DD (UTC). */
export function isoDate(now: Date = new Date()): string {
  const iso = now.toISOString();
  return iso.slice(0, 10);
}
