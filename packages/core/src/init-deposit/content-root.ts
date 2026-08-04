import { existsSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Locate the canonical pack payload (rule md files + Taskfile + tasks/ +
 * .githooks/) that `canon init`/`canon update` deposit.
 *
 * Two layouts:
 *  - "installed": @canonpack/content resolves via node module resolution and
 *    its package directory holds the payload flattened at its root (the
 *    package's own `prepack` copies content/*, Taskfile.yml, tasks/, and
 *    .githooks/ into the package before publish -- see
 *    packages/content/package.json, NOT modified here).
 *  - "workspace-fallback": resolution fails (this workspace's packages are
 *    pnpm-isolated -- @canonpack/core has no dependency on @canonpack/content)
 *    or the resolved package dir is an un-prepacked dev checkout (contains
 *    only package.json). Walk up from this module's directory to the pnpm
 *    workspace root and synthesize the same payload from
 *    <root>/content/*, <root>/Taskfile.yml, <root>/tasks/, <root>/.githooks/.
 */

export interface PayloadEntry {
  /** Path relative to the deposit root, POSIX separators, e.g. "canonical.md", "tasks/engine.yml". */
  readonly relPath: string;
  /** Absolute path to read the file content from. */
  readonly absPath: string;
}

export type ContentPayloadSource = "installed" | "workspace-fallback";

export interface ContentPayload {
  readonly source: ContentPayloadSource;
  readonly entries: readonly PayloadEntry[];
}

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

/** Payload from an already-assembled @canonpack/content package directory. */
function payloadFromContentDir(contentDir: string): PayloadEntry[] {
  const entries: PayloadEntry[] = [];
  for (const name of readdirSync(contentDir).sort()) {
    if (name === "package.json") {
      continue;
    }
    const abs = join(contentDir, name);
    const st = statSync(abs);
    if (st.isDirectory()) {
      entries.push(...listFilesRecursive(abs, name));
    } else if (st.isFile()) {
      entries.push({ relPath: name, absPath: abs });
    }
  }
  return entries;
}

/** True when a resolved @canonpack/content dir has nothing but package.json (prepack not run). */
function isUnpackedDevCheckout(contentDir: string): boolean {
  const names = readdirSync(contentDir).filter((n) => n !== "package.json");
  return names.length === 0;
}

function findWorkspaceRoot(startDir: string): string | null {
  let dir = startDir;
  for (let i = 0; i < 16; i++) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
  return null;
}

function payloadFromWorkspaceRoot(root: string): PayloadEntry[] {
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
  try {
    const req = createRequire(fromUrl);
    const pkgJsonPath = req.resolve("@canonpack/content/package.json");
    const contentDir = dirname(pkgJsonPath);
    if (!isUnpackedDevCheckout(contentDir)) {
      return { source: "installed", entries: payloadFromContentDir(contentDir) };
    }
    // Dev checkout, prepack not run -- fall through to the source-layout fallback.
  } catch {
    // Resolution failed (e.g. this package has no dependency on
    // @canonpack/content in a pnpm-isolated workspace) -- fall through.
  }

  const startDir = dirname(fileURLToPath(fromUrl));
  const root = findWorkspaceRoot(startDir);
  if (root === null) {
    throw new ContentRootResolutionError(
      "resolveContentRoot: could not resolve @canonpack/content and no pnpm-workspace.yaml found walking up from " +
        startDir,
    );
  }
  return { source: "workspace-fallback", entries: payloadFromWorkspaceRoot(root) };
}
