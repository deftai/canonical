import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteText } from "../fs/contained-write.js";
import { applyAgentsMd } from "./agents-md.js";
import type { ContentPayload } from "./content-root.js";
import { resolveContentRoot } from "./content-root.js";
import {
  copyPayloadInto,
  depositGitHooks,
  ensureGitignoreBaseline,
  ensureXbriefScaffold,
  writeVersionStamp,
} from "./deposit.js";
import { applyTaskfile } from "./taskfile.js";

export const CANONICAL_CORE_DEPOSIT = ".canonical/core";

export interface RunInitOptions {
  readonly now?: Date;
}

export interface RunInitResult {
  readonly code: 0 | 2;
  readonly message?: string;
  readonly written: readonly string[];
  readonly skipped: readonly string[];
  readonly warnings: readonly string[];
}

function isValidProjectRoot(projectRoot: string): boolean {
  try {
    return existsSync(projectRoot) && statSync(projectRoot).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Idempotent one-time (or re-run) deposit: payload -> .canonical/core/,
 * VERSION stamp, AGENTS.md managed section, root Taskfile.yml include,
 * xbrief/ scaffold, git hooks, .gitignore baseline. Every step is safe to
 * re-run: unchanged content is reported as skipped, not rewritten.
 */
export function runInit(projectRoot: string, opts: RunInitOptions = {}): RunInitResult {
  if (!isValidProjectRoot(projectRoot)) {
    return {
      code: 2,
      message: `not a directory: ${projectRoot}`,
      written: [],
      skipped: [],
      warnings: [],
    };
  }

  const written: string[] = [];
  const skipped: string[] = [];
  const warnings: string[] = [];

  let payload: ContentPayload;
  try {
    payload = resolveContentRoot();
  } catch (err) {
    return {
      code: 2,
      message: err instanceof Error ? err.message : String(err),
      written: [],
      skipped: [],
      warnings: [],
    };
  }

  // (1) payload -> .canonical/core/
  const corePayload = copyPayloadInto(projectRoot, CANONICAL_CORE_DEPOSIT, payload);
  written.push(...corePayload.written);
  skipped.push(...corePayload.skipped);

  // (2) VERSION stamp -- always refreshed.
  written.push(
    writeVersionStamp(projectRoot, CANONICAL_CORE_DEPOSIT, {
      source: payload.source,
      fetchedBy: "canon-init",
      now: opts.now,
    }),
  );

  // (3) AGENTS.md managed section.
  const agentsPath = join(projectRoot, "AGENTS.md");
  const agentsExisting = existsSync(agentsPath) ? readFileSync(agentsPath, "utf8") : null;
  const agentsPlan = applyAgentsMd(agentsExisting);
  if (agentsPlan.changed) {
    atomicWriteText(projectRoot, "AGENTS.md", agentsPlan.content);
    written.push("AGENTS.md");
  } else {
    skipped.push("AGENTS.md");
  }

  // (4) root Taskfile.yml include.
  const taskfilePath = join(projectRoot, "Taskfile.yml");
  const taskfileExisting = existsSync(taskfilePath) ? readFileSync(taskfilePath, "utf8") : null;
  const taskfilePlan = applyTaskfile(taskfileExisting);
  if (taskfilePlan.changed) {
    atomicWriteText(projectRoot, "Taskfile.yml", taskfilePlan.content);
    written.push("Taskfile.yml");
  } else {
    if (taskfilePlan.warning !== undefined) {
      process.stderr.write(`canon: warning -- ${taskfilePlan.warning}\n`);
    }
    skipped.push("Taskfile.yml");
  }

  // (5) xbrief/ scaffold.
  const xbriefOutcome = ensureXbriefScaffold(projectRoot);
  written.push(...xbriefOutcome.written);
  skipped.push(...xbriefOutcome.skipped);

  // (6) .githooks/ + core.hooksPath.
  const hooksOutcome = depositGitHooks(projectRoot, payload);
  written.push(...hooksOutcome.written);
  skipped.push(...hooksOutcome.skipped);
  warnings.push(...hooksOutcome.warnings);

  // (7) .gitignore baseline.
  const gitignoreOutcome = ensureGitignoreBaseline(projectRoot);
  written.push(...gitignoreOutcome.written);
  skipped.push(...gitignoreOutcome.skipped);

  return { code: 0, written, skipped, warnings };
}
