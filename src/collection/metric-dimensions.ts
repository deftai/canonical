import type { ScopeDoc } from "../types/index.js";
import { scopeDependencies, scopeKind } from "../types/index.js";
import { listScopes, readScope } from "../xbrief/brief-io.js";
import type { UsageDimensions } from "./emit.js";
export function bucketLifetimeHours(
  createdIso: string,
  now: Date = new Date(),
): "<1" | "1-4" | "4-24" | "24+" | undefined {
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
export function bucketAgentTurns(turns: number): "1-5" | "6-15" | "16-40" | "40+" {
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
export function bucketDurationHours(startedAtIso: string, now: Date = new Date()) {
  return bucketLifetimeHours(startedAtIso, now);
}
function cap(count: number): number {
  return Math.min(Math.max(count, 0), 5);
}
export function scopeCreatedDimensions(scope: ScopeDoc): UsageDimensions {
  return {
    kind: scopeKind(scope) ?? "story",
    has_acceptance_count: cap((scope.plan.items ?? []).length),
    dependency_count: scopeDependencies(scope).length,
  };
}
export function scopeStartDimensions(scope: ScopeDoc): UsageDimensions {
  return {
    kind: scopeKind(scope) ?? "story",
    acceptance_pending_count: cap(
      (scope.plan.items ?? []).filter((i) => i.status === "pending").length,
    ),
  };
}
export function scopeCompleteDimensions(
  scope: ScopeDoc,
  opts: { disposition?: string; hadDeliveryPr?: boolean; now?: Date } = {},
): UsageDimensions {
  const items = scope.plan.items ?? [];
  const total = cap(items.length);
  const dims: Record<string, string | number | boolean> = {
    kind: scopeKind(scope) ?? "story",
    acceptance_total: total,
    acceptance_completed: Math.min(items.filter((i) => i.status === "completed").length, total),
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
export function triageDimensions(
  decision: string,
  fromStatus: string,
  toStatus: string,
): UsageDimensions {
  return { decision, from_status: fromStatus, to_status: toStatus };
}
export function scopeStopDimensions(action: string): UsageDimensions {
  return { action };
}
export function xbriefInventoryDimensions(projectRoot: string): UsageDimensions {
  const counts: Record<string, number> = {
    proposed: 0,
    pending: 0,
    active: 0,
    completed: 0,
    cancelled: 0,
    deferred: 0,
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
