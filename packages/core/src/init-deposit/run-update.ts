import { existsSync, readFileSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteText } from "../fs/contained-write.js";
import { applyAgentsMd } from "./agents-md.js";
import type { ContentPayload } from "./content-root.js";
import { resolveContentRoot } from "./content-root.js";
import {
  depositGitHooks,
  diffPayloadAgainst,
  ensureGitignoreBaseline,
  writeAllPayload,
  writeVersionStamp,
} from "./deposit.js";
import { CANONICAL_CORE_DEPOSIT } from "./run-init.js";
import { applyTaskfile } from "./taskfile.js";

export interface RunUpdateOptions {
  readonly now?: Date;
}

export interface RunUpdateResult {
  readonly code: 0 | 2;
  readonly message?: string;
  readonly written: readonly string[];
  readonly skipped: readonly string[];
  readonly warnings: readonly string[];
}

/**
 * Refresh `.canonical/core/` via a stage -> swap -> prune sequence so a crash
 * mid-refresh never leaves a half-deposited core: stage the new payload into
 * `.canonical/core.staging`, move the live `core` aside to `core.bak`, move
 * staging into place, then remove `core.bak`. Any failure during the swap
 * restores `core.bak` back to `core`. Requires a prior `canon init`.
 */
export function runUpdate(projectRoot: string, opts: RunUpdateOptions = {}): RunUpdateResult {
  const corePath = join(projectRoot, CANONICAL_CORE_DEPOSIT);
  if (!existsSync(corePath)) {
    return {
      code: 2,
      message: `no existing deposit at ${CANONICAL_CORE_DEPOSIT} -- run \`canon init\` first.`,
      written: [],
      skipped: [],
      warnings: [],
    };
  }

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

  const written: string[] = [];
  const skipped: string[] = [];
  const warnings: string[] = [];

  // Report against the live deposit before it moves anywhere.
  const diff = diffPayloadAgainst(projectRoot, CANONICAL_CORE_DEPOSIT, payload);
  written.push(...diff.written);
  skipped.push(...diff.skipped);

  const stagingRel = `${CANONICAL_CORE_DEPOSIT}.staging`;
  const bakRel = `${CANONICAL_CORE_DEPOSIT}.bak`;
  const stagingPath = join(projectRoot, stagingRel);
  const bakPath = join(projectRoot, bakRel);

  if (existsSync(stagingPath)) {
    rmSync(stagingPath, { recursive: true, force: true });
  }
  if (existsSync(bakPath)) {
    rmSync(bakPath, { recursive: true, force: true });
  }

  writeAllPayload(projectRoot, stagingRel, payload);

  let bakMoved = false;
  try {
    renameSync(corePath, bakPath);
    bakMoved = true;
    renameSync(stagingPath, corePath);
  } catch (err) {
    // Restore: if core is gone but the backup exists, put it back.
    if (bakMoved && !existsSync(corePath) && existsSync(bakPath)) {
      renameSync(bakPath, corePath);
    }
    rmSync(stagingPath, { recursive: true, force: true });
    return {
      code: 2,
      message: `deposit swap failed, restored previous core: ${err instanceof Error ? err.message : String(err)}`,
      written: [],
      skipped: [],
      warnings,
    };
  }
  rmSync(bakPath, { recursive: true, force: true });

  // Re-stamp VERSION only after a successful swap.
  written.push(
    writeVersionStamp(projectRoot, CANONICAL_CORE_DEPOSIT, {
      source: payload.source,
      fetchedBy: "canon-update",
      now: opts.now,
    }),
  );

  // Re-run the idempotent derivative steps.
  const agentsPath = join(projectRoot, "AGENTS.md");
  const agentsExisting = existsSync(agentsPath) ? readFileSync(agentsPath, "utf8") : null;
  const agentsPlan = applyAgentsMd(agentsExisting);
  if (agentsPlan.changed) {
    atomicWriteText(projectRoot, "AGENTS.md", agentsPlan.content);
    written.push("AGENTS.md");
  } else {
    skipped.push("AGENTS.md");
  }

  const taskfilePath = join(projectRoot, "Taskfile.yml");
  const taskfileExisting = existsSync(taskfilePath) ? readFileSync(taskfilePath, "utf8") : null;
  const taskfilePlan = applyTaskfile(taskfileExisting);
  if (taskfilePlan.changed) {
    atomicWriteText(projectRoot, "Taskfile.yml", taskfilePlan.content);
    written.push("Taskfile.yml");
  } else {
    skipped.push("Taskfile.yml");
  }

  const hooksOutcome = depositGitHooks(projectRoot, payload);
  written.push(...hooksOutcome.written);
  skipped.push(...hooksOutcome.skipped);
  warnings.push(...hooksOutcome.warnings);

  const gitignoreOutcome = ensureGitignoreBaseline(projectRoot);
  written.push(...gitignoreOutcome.written);
  skipped.push(...gitignoreOutcome.skipped);

  return { code: 0, written, skipped, warnings };
}
