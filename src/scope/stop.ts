import type { ScopeFile, ScopeStatus } from "../types/index.js";
import { appendAudit } from "../xbrief/audit.js";
import { findScope, readScope, transitionScope } from "../xbrief/brief-io.js";

/**
 * `scope:stop` verb (content/canonical-tasks.md #scope:stop, content/state.md Lifecycle).
 * Non-happy terminal or pause. Exactly one mode per call; legality is checked
 * against the scope's current status (the source of truth per content/state.md).
 */

export const STOP_MODES = ["cancel", "fail", "block", "unblock", "demote"] as const;
export type StopMode = (typeof STOP_MODES)[number];

export function isStopMode(value: string): value is StopMode {
  return (STOP_MODES as readonly string[]).includes(value);
}

const TERMINAL_STATUSES: ReadonlySet<ScopeStatus> = new Set(["completed", "failed", "cancelled"]);
const ACTIVE_STATUSES: ReadonlySet<ScopeStatus> = new Set(["running", "blocked"]);

/** Legal target status for `mode` given the scope's `current` status, or null if illegal. */
function targetStatus(mode: StopMode, current: ScopeStatus): ScopeStatus | null {
  switch (mode) {
    case "cancel":
      return TERMINAL_STATUSES.has(current) ? null : "cancelled";
    case "fail":
      return ACTIVE_STATUSES.has(current) ? "failed" : null;
    case "block":
      return current === "running" ? "blocked" : null;
    case "unblock":
      return current === "blocked" ? "running" : null;
    case "demote":
      return ACTIVE_STATUSES.has(current) ? "pending" : null;
  }
}

function appendNote(existing: string | undefined, note: string): string {
  return existing !== undefined && existing !== "" ? `${existing}\n${note}` : note;
}

export interface ScopeStopOptions {
  /** Identifier resolved via findScope (relative path, filename, or slug fragment). */
  readonly scope: string;
  readonly mode: StopMode;
  readonly note?: string;
  readonly now?: Date;
}

export type ScopeStopResult =
  | { readonly ok: true; readonly scope: string; readonly status: ScopeStatus }
  | { readonly ok: false; readonly code: 1 | 2; readonly message: string };

export function scopeStop(projectRoot: string, opts: ScopeStopOptions): ScopeStopResult {
  const now = opts.now ?? new Date();
  const found = findScope(projectRoot, opts.scope);
  if (found === null) {
    return { ok: false, code: 2, message: `no scope matching '${opts.scope}'` };
  }
  if ("ambiguous" in found) {
    return {
      ok: false,
      code: 2,
      message: `'${opts.scope}' is ambiguous: ${found.ambiguous.join(", ")}`,
    };
  }
  const ref = found;

  const readResult = readScope(ref.path);
  if (!readResult.ok) {
    return { ok: false, code: 2, message: readResult.message };
  }
  const scope = readResult.scope;
  const current = scope.plan.status;

  const next = targetStatus(opts.mode, current);
  if (next === null) {
    return { ok: false, code: 1, message: `cannot ${opts.mode} scope with status '${current}'` };
  }

  let updated: ScopeFile = scope;
  if (opts.note !== undefined && opts.note.trim() !== "") {
    updated = {
      ...scope,
      narratives: { ...scope.narratives, Note: appendNote(scope.narratives?.Note, opts.note) },
    };
  }

  const newRef = transitionScope(projectRoot, ref, updated, next, now);
  appendAudit(
    projectRoot,
    {
      kind: "scope-stop",
      mode: opts.mode,
      scope: newRef.relPath,
      from: current,
      to: next,
      ...(opts.note !== undefined ? { note: opts.note } : {}),
    },
    now,
  );

  return { ok: true, scope: newRef.relPath, status: next };
}
