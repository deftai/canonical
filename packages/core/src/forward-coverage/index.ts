import { basename } from "node:path";
import type { GateResult } from "@canonpack/types";
import { type GitRunner, stagedFiles, stagedNewFiles } from "../git/index.js";
import { readProjectBrief } from "../policy/index.js";

/**
 * verify:forward-coverage (content/canonical-tasks.md): every STAGED NEW
 * source file under a configured root must ship with a staged new-or-modified
 * test file in the same commit. Pure function of the staged git index +
 * briefs/PROJECT.json `quality.forwardCoverageRoots` override.
 */

export const DEFAULT_ROOTS: readonly string[] = ["src/", "lib/", "cmd/", "scripts/", "packages/"];

const SOURCE_EXTENSIONS: ReadonlySet<string> = new Set([".ts", ".js", ".py", ".go"]);

export interface MissingCoverage {
  readonly path: string;
  readonly expectedTests: readonly string[];
}

export interface ForwardCoverageOptions {
  /** Injectable git seam (tests). Defaults to the real `git` binary. */
  readonly runner?: GitRunner;
  /** Override the configured roots (tests / callers that already resolved it). */
  readonly roots?: readonly string[];
}

export interface ForwardCoverageResult extends GateResult {
  readonly missing: readonly MissingCoverage[];
}

function extOf(pathStr: string): string {
  const b = basename(pathStr);
  const dot = b.lastIndexOf(".");
  return dot > 0 ? b.slice(dot).toLowerCase() : "";
}

/** True for the co-located TS/JS `.test`/`.spec`, Go `*_test.go`, Python `test_*.py` conventions. */
export function isTestFile(relPath: string): boolean {
  const b = basename(relPath).toLowerCase();
  if (b.endsWith(".test.ts") || b.endsWith(".spec.ts")) {
    return true;
  }
  if (b.endsWith(".test.js") || b.endsWith(".spec.js")) {
    return true;
  }
  if (b.endsWith("_test.go")) {
    return true;
  }
  if (b.endsWith(".py") && (b.startsWith("test_") || b.endsWith("_test.py"))) {
    return true;
  }
  return false;
}

/** True when `relPath` sits under one of `roots` and is an in-scope, non-test, non-`.d.ts` source file. */
export function isSourceFile(relPath: string, roots: readonly string[]): boolean {
  const posix = relPath.replace(/\\/g, "/");
  const b = basename(posix).toLowerCase();
  if (b.endsWith(".d.ts")) {
    return false;
  }
  if (!SOURCE_EXTENSIONS.has(extOf(b))) {
    return false;
  }
  if (isTestFile(posix)) {
    return false;
  }
  if (roots.length === 0) {
    return true;
  }
  return roots.some((root) => posix.startsWith(root));
}

/** Candidate test-file basenames that would satisfy forward coverage for a source file. */
export function expectedTestBasenames(sourcePath: string): string[] {
  const b = basename(sourcePath);
  const ext = extOf(b);
  const stem = b.slice(0, b.length - ext.length);
  switch (ext) {
    case ".ts":
      return [`${stem}.test.ts`, `${stem}.spec.ts`];
    case ".js":
      return [`${stem}.test.js`, `${stem}.spec.js`];
    case ".py":
      return [`test_${stem}.py`, `${stem}_test.py`];
    case ".go":
      return [`${stem}_test.go`];
    default:
      return [];
  }
}

function loadConfiguredRoots(projectRoot: string): readonly string[] {
  const read = readProjectBrief(projectRoot);
  if (!read.ok) {
    return DEFAULT_ROOTS;
  }
  const quality = (read.project as Record<string, unknown>).quality as
    | Record<string, unknown>
    | undefined;
  const raw = quality?.forwardCoverageRoots;
  if (Array.isArray(raw) && raw.length > 0 && raw.every((r) => typeof r === "string")) {
    return raw as string[];
  }
  return DEFAULT_ROOTS;
}

/**
 * Evaluate the forward-coverage gate over the staged index: exit 0 clean, 1
 * listing new source files with no matching staged test, or 2 on a git
 * failure (e.g. git missing on PATH).
 */
export function evaluateForwardCoverage(
  projectRoot: string,
  opts: ForwardCoverageOptions = {},
): ForwardCoverageResult {
  const run = opts.runner;
  const roots = opts.roots ?? loadConfiguredRoots(projectRoot);

  let allStaged: readonly string[];
  let newStaged: readonly string[];
  try {
    allStaged = stagedFiles(projectRoot, run);
    newStaged = stagedNewFiles(projectRoot, run);
  } catch (err) {
    return {
      code: 2,
      missing: [],
      message: `verify:forward-coverage: git failed -- ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const posixAllStaged = allStaged.map((p) => p.replace(/\\/g, "/"));
  const stagedTestBasenames = new Set(
    posixAllStaged.filter((p) => isTestFile(p)).map((p) => basename(p)),
  );

  const missing: MissingCoverage[] = [];
  let checked = 0;
  for (const rel of newStaged.map((p) => p.replace(/\\/g, "/"))) {
    if (!isSourceFile(rel, roots)) {
      continue;
    }
    checked += 1;
    const expected = expectedTestBasenames(rel);
    const covered = expected.some((name) => stagedTestBasenames.has(name));
    if (!covered) {
      missing.push({ path: rel, expectedTests: expected });
    }
  }

  if (missing.length > 0) {
    const body = missing
      .map((m) => `  ${m.path}\n    expected one of: ${m.expectedTests.join(", ")}`)
      .join("\n");
    return {
      code: 1,
      missing,
      message:
        `verify:forward-coverage: ${missing.length} new source file(s) staged without a ` +
        `corresponding staged test.\n${body}`,
    };
  }

  return {
    code: 0,
    missing,
    message: `verify:forward-coverage: ${checked} new source file(s) checked -- all covered.`,
  };
}
