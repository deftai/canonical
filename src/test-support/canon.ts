/**
 * CLI test runner for collection characterization: dispatch + drain soft emits,
 * with stdout/stderr capture and project-root injection.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, vi } from "vitest";
import { dispatch, resetHandlerCacheForTests } from "../cli/dispatch.js";
import { drainSoftEmits, resetPendingSoftEmitsForTests } from "../collection/index.js";
import { type FakeCollector, fakeCollector } from "./collector.js";
import { tempDir, tempGitRepo } from "./temp.js";

export interface CanonResult {
  readonly code: number;
  readonly out: string;
  readonly err: string;
}

export interface CanonOptions {
  readonly cwd: string;
}

/** Ensure argv reaches the project under test via --project-root. */
function withProjectRoot(argv: string[], cwd: string): string[] {
  if (argv.some((a) => a === "--project-root" || a.startsWith("--project-root="))) {
    return argv;
  }
  if (argv.length === 0) {
    return [`--project-root=${cwd}`];
  }
  const verb = argv[0];
  if (verb === undefined) {
    return [`--project-root=${cwd}`];
  }
  return [verb, `--project-root=${cwd}`, ...argv.slice(1)];
}

/**
 * Run a canon verb through `dispatch`, drain soft emits, capture stdio.
 * Does not call process.exit.
 */
export async function canon(argv: string[], opts: CanonOptions): Promise<CanonResult> {
  const outChunks: string[] = [];
  const errChunks: string[] = [];
  const outSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    outChunks.push(String(chunk));
    return true;
  });
  const errSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    errChunks.push(String(chunk));
    return true;
  });
  try {
    const code = await dispatch(withProjectRoot(argv, opts.cwd));
    await drainSoftEmits();
    return { code, out: outChunks.join(""), err: errChunks.join("") };
  } finally {
    outSpy.mockRestore();
    errSpy.mockRestore();
  }
}

export interface CollectionHarness {
  readonly root: string;
  readonly home: string;
  readonly fake: FakeCollector;
}

/**
 * Temp git project + stubbed HOME/USERPROFILE + fake collector as global fetch.
 * WP1: baseline still writes ~/.config/canonical/identity.json (ARC-8).
 */
export function installCollectionHarness(opts: { withBriefs?: boolean } = {}): CollectionHarness {
  const home = tempDir("canon-home-");
  const root = tempGitRepo({ withBriefs: opts.withBriefs });
  const fake = fakeCollector();
  vi.stubGlobal("fetch", fake.fetch);
  vi.stubEnv("HOME", home);
  vi.stubEnv("USERPROFILE", home);
  return { root, home, fake };
}

/** Read `.canonical/collection.json` from a project root (empty object if missing). */
export function readCollectionState(root: string): Record<string, unknown> {
  const path = join(root, ".canonical", "collection.json");
  if (!existsSync(path)) {
    return {};
  }
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Register afterEach cleanup used by WP1 collection tests. */
export function installCollectionTestHooks(): void {
  afterEach(() => {
    resetPendingSoftEmitsForTests();
    resetHandlerCacheForTests();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });
}
