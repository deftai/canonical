import type { ScopeDoc } from "../types/index.js";
import { scopeDependencies, scopeKind } from "../types/index.js";
import { listScopes, readScope } from "../xbrief/brief-io.js";
import type { UsageDimensions } from "./emit.js";

export type LifetimeHoursBucket = "<1" | "1-4" | "4-24" | "24+";
export type AgentTurnsBucket = "1-5" | "6-15" | "16-40" | "40+";
export type DurationBucket = LifetimeHoursBucket;

/** Bucket scope age at completion (issue #9). */
export function bucketLifetimeHours(
  createdIso: string,
  now: Date = new Date(),
): LifetimeHoursBucket | undefined {
  const created = Date.parse(createdIso);
  if (Number.isNaN(created)) {
    return undefined;
  }
  const hours = (now.getTime() - created) / 3_600_000;
  if (hours < 1) {
    return "<1";
  }
  if (hours < 4) {
    return "1-4";
  }
  if (hours < 24) {
    return "4-24";
  }
  return "24+";
}

/** Bucket agent turn count for session_summary (issue #9). */
export function bucketAgentTurns(turns: number): AgentTurnsBucket {
  if (turns <= 5) {
    return "1-5";
  }
  if (turns <= 15) {
    return "6-15";
  }
  if (turns <= 40) {
    return "16-40";
  }
  return "40+";
}

/** Bucket session duration from startedAt (issue #9). */
export function bucketDurationHours(
  startedAtIso: string,
  now: Date = new Date(),
): DurationBucket | undefined {
  return bucketLifetimeHours(startedAtIso, now);
}

function cappedAcceptanceCount(count: number): number {
  return Math.min(Math.max(count, 0), 5);
}

/** Dimensions for xbrief_scope_created (scope:new). */
export function scopeCreatedDimensions(scope: ScopeDoc): UsageDimensions {
  const kind = scopeKind(scope) ?? "story";
  const items = scope.plan.items ?? [];
  return {
    kind,
    has_acceptance_count: cappedAcceptanceCount(items.length),
    dependency_count: scopeDependencies(scope).length,
  };
}

/** Dimensions for xbrief_scope_start (scope:start). */
export function scopeStartDimensions(scope: ScopeDoc): UsageDimensions {
  const kind = scopeKind(scope) ?? "story";
  const pending = (scope.plan.items ?? []).filter((i) => i.status === "pending").length;
  return {
    kind,
    acceptance_pending_count: cappedAcceptanceCount(pending),
  };
}

/** Dimensions for scope_complete (issue #9 enriched). */
export function scopeCompleteDimensions(
  scope: ScopeDoc,
  opts: { disposition?: string; hadDeliveryPr?: boolean; now?: Date } = {},
): UsageDimensions {
  const kind = scopeKind(scope) ?? "story";
  const items = scope.plan.items ?? [];
  const total = cappedAcceptanceCount(items.length);
  const completed = Math.min(items.filter((i) => i.status === "completed").length, total);
  const dims: Record<string, string | number | boolean> = {
    kind,
    acceptance_total: total,
    acceptance_completed: completed,
    dependency_count: scopeDependencies(scope).length,
  };
  if (opts.disposition !== undefined) {
    dims.disposition = opts.disposition;
  }
  if (opts.hadDeliveryPr === true) {
    dims.had_delivery_pr = true;
  }
  const lifetime = bucketLifetimeHours(scope.plan.created, opts.now);
  if (lifetime !== undefined) {
    dims.lifetime_hours = lifetime;
  }
  return dims;
}

/** Dimensions for xbrief_triage. */
export function triageDimensions(
  decision: string,
  fromStatus: string,
  toStatus: string,
): UsageDimensions {
  return { decision, from_status: fromStatus, to_status: toStatus };
}

/** Dimensions for xbrief_scope_stop. */
export function scopeStopDimensions(action: string): UsageDimensions {
  return { action };
}

/** Integer counts by lifecycle folder + blocked status (issue #9). */
export function xbriefInventoryDimensions(projectRoot: string): UsageDimensions {
  const counts: Record<string, number> = {
    proposed: 0,
    pending: 0,
    active: 0,
    completed: 0,
    cancelled: 0,
    blocked: 0,
  };
  for (const ref of listScopes(projectRoot)) {
    if (ref.folder in counts) {
      counts[ref.folder] = (counts[ref.folder] ?? 0) + 1;
    }
    const read = readScope(ref.path);
    if (read.ok && read.scope.plan.status === "blocked") {
      counts.blocked = (counts.blocked ?? 0) + 1;
    }
  }
  return counts;
}
