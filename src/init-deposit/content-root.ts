import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Locate the canonical pack payload (rule md files + Taskfile + tasks/ +
 * .githooks/) that `canon init`/`canon update` deposit.
 *
 * Single-package model: the payload ships as plain files inside THIS package
 * (`@deftai/canonical`) -- content/, Taskfile.yml, tasks/, .githooks/ at the
 * package root, next to dist/. One code path serves both the npm-installed
 * layout and a dev checkout, because they are the same layout.
 */

export interface PayloadEntry {
  /** Path relative to the deposit root, POSIX separators, e.g. "canonical.md", "tasks/engine.yml". */
  readonly relPath: string;
  /** Absolute path to read the file content from. */
  readonly absPath: string;
}

export type ContentPayloadSource = "package";

export interface ContentPayload {
  readonly source: ContentPayloadSource;
  readonly entries: readonly PayloadEntry[];
}

const PACKAGE_NAME = "@deftai/canonical";

function toPosix(relPath: string): string {
  return relPath.split("\\").join("/");
}

function listFilesRecursive(absDir: string, relPrefix: string): PayloadEntry[] {
  const out: PayloadEntry[] = [];
  if (!existsSync(absDir)) {
    return out;
  }
  for (const name of readdirSync(absDir).sort()) {
    const abs = join(absDir, name);
    const rel = toPosix(relPrefix ? `${relPrefix}/${name}` : name);
    const st = statSync(abs);
    if (st.isDirectory()) {
      out.push(...listFilesRecursive(abs, rel));
    } else if (st.isFile()) {
      out.push({ relPath: rel, absPath: abs });
    }
  }
  return out;
}

/** Walk up from a directory to the root of THIS package (package.json named @deftai/canonical). */
function findPackageRoot(startDir: string): string | null {
  let dir = startDir;
  for (let i = 0; i < 16; i++) {
    const pkgPath = join(dir, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { name?: string };
        if (pkg.name === PACKAGE_NAME) {
          return dir;
        }
      } catch {
        // unreadable package.json -- keep walking
      }
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
  return null;
}

function payloadFromPackageRoot(root: string): PayloadEntry[] {
  const entries: PayloadEntry[] = [];
  const contentDir = join(root, "content");
  if (existsSync(contentDir)) {
    for (const name of readdirSync(contentDir).sort()) {
      const abs = join(contentDir, name);
      if (statSync(abs).isFile()) {
        entries.push({ relPath: name, absPath: abs });
      }
    }
  }
  const taskfile = join(root, "Taskfile.yml");
  if (existsSync(taskfile)) {
    entries.push({ relPath: "Taskfile.yml", absPath: taskfile });
  }
  entries.push(...listFilesRecursive(join(root, "tasks"), "tasks"));
  entries.push(...listFilesRecursive(join(root, ".githooks"), ".githooks"));
  return entries;
}

export class ContentRootResolutionError extends Error {}

/**
 * `fromUrl` defaults to this module's own URL; tests may pass a different
 * module URL to exercise the walk-up from another location.
 */
export function resolveContentRoot(fromUrl: string = import.meta.url): ContentPayload {
  const startDir = dirname(fileURLToPath(fromUrl));
  const root = findPackageRoot(startDir);
  if (root === null) {
    throw new ContentRootResolutionError(
      `resolveContentRoot: no package.json named ${PACKAGE_NAME} found walking up from ${startDir}`,
    );
  }
  return { source: "package", entries: payloadFromPackageRoot(root) };
}
