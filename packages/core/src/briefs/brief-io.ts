import { existsSync, readdirSync, readFileSync, renameSync } from "node:fs";
import { basename, join } from "node:path";
import type { LifecycleFolder, ScopeFile, ScopeStatus } from "@canonpack/types";
import { LIFECYCLE_FOLDERS, SCOPE_FILENAME_RE, STATUS_FOLDER_MAP } from "@canonpack/types";
import { atomicWriteJson } from "../fs/contained-write.js";

/** briefs/ path helpers + scope file read/write. Reads never throw on bad JSON -- they return result objects. */

export function briefsRoot(projectRoot: string): string {
  return join(projectRoot, "briefs");
}

export function lifecycleDir(projectRoot: string, folder: LifecycleFolder): string {
  return join(briefsRoot(projectRoot), folder);
}

export function briefsExist(projectRoot: string): boolean {
  return existsSync(briefsRoot(projectRoot));
}

export interface ScopeRef {
  /** Absolute path. */
  readonly path: string;
  /** Path relative to project root, POSIX separators (e.g. "briefs/active/2026-08-04-x.json"). */
  readonly relPath: string;
  readonly folder: LifecycleFolder;
  readonly filename: string;
}

export type ReadScopeResult =
  | { readonly ok: true; readonly scope: ScopeFile }
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
    return { ok: true, scope: parsed as ScopeFile };
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
        relPath: `briefs/${folder}/${name}`,
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

/** Write scope JSON in place (atomic). Target expressed relative to project root. */
export function writeScope(projectRoot: string, relPath: string, scope: ScopeFile): void {
  atomicWriteJson(projectRoot, relPath, scope);
}

/**
 * Move a scope file to the folder matching `newStatus` and update
 * plan.status + plan.updated in one operation. Returns the new ScopeRef.
 */
export function transitionScope(
  projectRoot: string,
  ref: ScopeRef,
  scope: ScopeFile,
  newStatus: ScopeStatus,
  now: Date = new Date(),
): ScopeRef {
  const targetFolder = STATUS_FOLDER_MAP[newStatus];
  const updated: ScopeFile = {
    ...scope,
    plan: { ...scope.plan, status: newStatus, updated: now.toISOString() },
  };
  const targetRel = `briefs/${targetFolder}/${ref.filename}`;
  atomicWriteJson(projectRoot, ref.relPath, updated);
  if (targetFolder !== ref.folder) {
    renameSync(ref.path, join(lifecycleDir(projectRoot, targetFolder), ref.filename));
  }
  return {
    path: join(lifecycleDir(projectRoot, targetFolder), ref.filename),
    relPath: targetRel,
    folder: targetFolder,
    filename: ref.filename,
  };
}

/** Normalize a title to the canonical slug: lowercase [a-z0-9-], <=80 chars. */
export function normalizeSlug(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 80)
    .replace(/-+$/, "");
  return slug;
}

/** Today's date as YYYY-MM-DD (UTC). */
export function isoDate(now: Date = new Date()): string {
  const iso = now.toISOString();
  return iso.slice(0, 10);
}
