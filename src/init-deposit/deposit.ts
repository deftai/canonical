import { chmodSync, existsSync, readFileSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { atomicWriteText } from "../fs/contained-write.js";
import { isGitRepo, setConfig } from "../git/index.js";
import { buildProjectSkeleton } from "../policy/index.js";
import { LIFECYCLE_FOLDERS, PROJECT_BRIEF_NAME } from "../types/index.js";
import { canonicalStringify } from "../xbrief/brief-io.js";
import type { ContentPayload } from "./content-root.js";

/** Low-level deposit primitives shared by `runInit` and `runUpdate`. */

export interface CopyOutcome {
  readonly written: readonly string[];
  readonly skipped: readonly string[];
}

/**
 * Compare every payload entry against `destRelRoot` (relative to
 * `projectRoot`) without writing anything. Used both to decide whether a
 * write is needed and to report a stable written-vs-skipped summary when the
 * physical write target differs from the comparison target (`canon update`
 * diffs against the live deposit but writes into a staging dir).
 */
export function diffPayloadAgainst(
  projectRoot: string,
  destRelRoot: string,
  payload: ContentPayload,
): CopyOutcome {
  const written: string[] = [];
  const skipped: string[] = [];
  for (const entry of payload.entries) {
    const relTarget = `${destRelRoot}/${entry.relPath}`;
    const absTarget = join(projectRoot, relTarget);
    const data = readFileSync(entry.absPath, "utf8");
    if (existsSync(absTarget) && readFileSync(absTarget, "utf8") === data) {
      skipped.push(relTarget);
    } else {
      written.push(relTarget);
    }
  }
  return { written, skipped };
}

/**
 * Copy every payload entry to `destRelRoot` (relative to `projectRoot`),
 * through contained-write. Unchanged files are reported as skipped rather
 * than rewritten, so repeat `canon init` runs report a stable summary.
 */
export function copyPayloadInto(
  projectRoot: string,
  destRelRoot: string,
  payload: ContentPayload,
): CopyOutcome {
  const written: string[] = [];
  const skipped: string[] = [];
  for (const entry of payload.entries) {
    const relTarget = `${destRelRoot}/${entry.relPath}`;
    const absTarget = join(projectRoot, relTarget);
    const data = readFileSync(entry.absPath, "utf8");
    if (existsSync(absTarget) && readFileSync(absTarget, "utf8") === data) {
      skipped.push(relTarget);
      continue;
    }
    atomicWriteText(projectRoot, relTarget, data);
    written.push(relTarget);
  }
  return { written, skipped };
}

/** Write every payload entry to `destRelRoot`, unconditionally (staging dir is fresh). */
export function writeAllPayload(
  projectRoot: string,
  destRelRoot: string,
  payload: ContentPayload,
): readonly string[] {
  const written: string[] = [];
  for (const entry of payload.entries) {
    const relTarget = `${destRelRoot}/${entry.relPath}`;
    const data = readFileSync(entry.absPath, "utf8");
    atomicWriteText(projectRoot, relTarget, data);
    written.push(relTarget);
  }
  return written;
}

export interface VersionFields {
  readonly source: string;
  readonly fetchedBy: "canon-init" | "canon-update";
  readonly now?: Date;
}

/** Write `.canonical/core/VERSION` -- lines: ref/tag/install_root/fetched_at/fetched_by. */
export function writeVersionStamp(
  projectRoot: string,
  deposit: string,
  fields: VersionFields,
): string {
  const now = fields.now ?? new Date();
  const body =
    `ref: ${fields.source}\n` +
    "tag: unknown\n" +
    `install_root: ${deposit}\n` +
    `fetched_at: ${now.toISOString()}\n` +
    `fetched_by: ${fields.fetchedBy}\n`;
  const rel = `${deposit}/VERSION`;
  atomicWriteText(projectRoot, rel, body);
  return rel;
}

/** Five lifecycle dirs + .gitkeep, and xbrief/PROJECT.xbrief.json skeleton, only where absent. */
export function ensureXbriefScaffold(projectRoot: string): CopyOutcome {
  const written: string[] = [];
  const skipped: string[] = [];
  for (const folder of LIFECYCLE_FOLDERS) {
    const rel = `xbrief/${folder}/.gitkeep`;
    if (existsSync(join(projectRoot, rel))) {
      skipped.push(rel);
      continue;
    }
    atomicWriteText(projectRoot, rel, "");
    written.push(rel);
  }
  const projectRel = `xbrief/${PROJECT_BRIEF_NAME}`;
  if (existsSync(join(projectRoot, projectRel))) {
    skipped.push(projectRel);
  } else {
    const title = basename(resolve(projectRoot));
    atomicWriteText(projectRoot, projectRel, canonicalStringify(buildProjectSkeleton(title)));
    written.push(projectRel);
  }
  return { written, skipped };
}

const GITIGNORE_BASELINE = [".canonical/core/", ".canonical/cache/", "xbrief/*.lock"] as const;

/** Append any of the baseline .gitignore lines that are missing; skip if all present. */
export function ensureGitignoreBaseline(projectRoot: string): CopyOutcome {
  const rel = ".gitignore";
  const abs = join(projectRoot, rel);
  const existing = existsSync(abs) ? readFileSync(abs, "utf8") : "";
  const present = new Set(
    existing
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0),
  );
  const missing = GITIGNORE_BASELINE.filter((line) => !present.has(line));
  if (missing.length === 0) {
    return { written: [], skipped: [rel] };
  }
  const sep = existing.length === 0 || existing.endsWith("\n") ? "" : "\n";
  const body = `${existing}${sep}${missing.join("\n")}\n`;
  atomicWriteText(projectRoot, rel, body);
  return { written: [rel], skipped: [] };
}

const HOOK_FILENAMES = new Set(["pre-commit", "pre-push"]);

export interface GitHooksOutcome extends CopyOutcome {
  readonly warnings: readonly string[];
}

/**
 * Copy `.githooks/` from the payload to the project root (a real path git can
 * point `core.hooksPath` at) and wire `core.hooksPath=.githooks`. When the
 * project is not a git repo, warn and continue rather than failing the whole
 * deposit.
 */
export function depositGitHooks(projectRoot: string, payload: ContentPayload): GitHooksOutcome {
  const written: string[] = [];
  const skipped: string[] = [];
  const warnings: string[] = [];
  const hookEntries = payload.entries.filter((e) => e.relPath.startsWith(".githooks/"));
  for (const entry of hookEntries) {
    const absTarget = join(projectRoot, entry.relPath);
    const data = readFileSync(entry.absPath, "utf8");
    const unchanged = existsSync(absTarget) && readFileSync(absTarget, "utf8") === data;
    if (unchanged) {
      skipped.push(entry.relPath);
    } else {
      atomicWriteText(projectRoot, entry.relPath, data);
      written.push(entry.relPath);
    }
    const name = entry.relPath.slice(".githooks/".length);
    if (HOOK_FILENAMES.has(name)) {
      try {
        const mode = statSync(absTarget).mode & 0o777;
        if ((mode & 0o111) === 0) {
          chmodSync(absTarget, 0o755);
        }
      } catch {
        // non-fatal
      }
    }
  }

  if (!isGitRepo(projectRoot)) {
    warnings.push(`${projectRoot} is not a git repository -- skipped git config core.hooksPath.`);
    return { written, skipped, warnings };
  }
  if (!setConfig(projectRoot, "core.hooksPath", ".githooks")) {
    warnings.push("could not set git config core.hooksPath=.githooks.");
  }
  return { written, skipped, warnings };
}
