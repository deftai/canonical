import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteJson } from "../fs/contained-write.js";

/**
 * Sticky PR review-ownership lease (content/canonical-tasks.md `review-monitor`,
 * content/multi-agent.md "Review Ownership & CLEAN"). Persists to
 * `.canonical/review-monitor.json`.
 */

export const REVIEW_MONITOR_REL = ".canonical/review-monitor.json";

export interface ReviewLease {
  readonly pr: number;
  readonly owner: string;
  readonly registered: string;
}

export interface ReviewMonitorState {
  readonly leases: readonly ReviewLease[];
}

export function reviewMonitorPath(projectRoot: string): string {
  return join(projectRoot, REVIEW_MONITOR_REL);
}

type ReadStateResult =
  | { readonly ok: true; readonly state: ReviewMonitorState }
  | { readonly ok: false; readonly message: string };

function readState(projectRoot: string): ReadStateResult {
  const path = reviewMonitorPath(projectRoot);
  if (!existsSync(path)) {
    return { ok: true, state: { leases: [] } };
  }
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    return {
      ok: false,
      message: `cannot read ${path}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      !Array.isArray((parsed as { leases?: unknown }).leases)
    ) {
      return { ok: false, message: `${path}: expected { leases: [] }` };
    }
    return { ok: true, state: parsed as ReviewMonitorState };
  } catch (err) {
    return {
      ok: false,
      message: `${path}: invalid JSON (${err instanceof Error ? err.message : String(err)})`,
    };
  }
}

function writeState(projectRoot: string, state: ReviewMonitorState): void {
  atomicWriteJson(projectRoot, REVIEW_MONITOR_REL, state);
}

export interface RegisterResult {
  readonly code: 0 | 2;
  readonly message?: string;
  readonly lease?: ReviewLease;
}

/** Register (or replace) the lease for `pr`, owned by `owner`. */
export function registerLease(
  projectRoot: string,
  pr: number,
  owner: string,
  now: Date = new Date(),
): RegisterResult {
  const read = readState(projectRoot);
  if (!read.ok) {
    return { code: 2, message: read.message };
  }
  const lease: ReviewLease = { pr, owner, registered: now.toISOString() };
  const leases = read.state.leases.filter((l) => l.pr !== pr);
  leases.push(lease);
  writeState(projectRoot, { leases });
  return { code: 0, lease };
}

export interface ReleaseResult {
  readonly code: 0 | 2;
  readonly message?: string;
  readonly released: boolean;
}

/** Release the lease for `pr`, if any. Not having one is not an error. */
export function releaseLease(projectRoot: string, pr: number): ReleaseResult {
  const read = readState(projectRoot);
  if (!read.ok) {
    return { code: 2, message: read.message, released: false };
  }
  const before = read.state.leases.length;
  const leases = read.state.leases.filter((l) => l.pr !== pr);
  writeState(projectRoot, { leases });
  return { code: 0, released: leases.length !== before };
}

export interface CheckResult {
  readonly code: 0 | 1 | 2;
  readonly message?: string;
  readonly lease?: ReviewLease;
}

/** 0 active lease (returned) · 1 none · 2 error. */
export function checkLease(projectRoot: string, pr: number): CheckResult {
  const read = readState(projectRoot);
  if (!read.ok) {
    return { code: 2, message: read.message };
  }
  const lease = read.state.leases.find((l) => l.pr === pr);
  if (lease === undefined) {
    return { code: 1 };
  }
  return { code: 0, lease };
}
