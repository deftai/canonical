import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteJson } from "../fs/contained-write.js";
import { hasUsageConsent } from "./consent.js";
import type { UsageDimensions } from "./emit.js";
import { bucketAgentTurns, bucketDurationHours } from "./metric-dimensions.js";

const SESSION_REL = ".canonical/collection-session.json";
const INVENTORY_REL = ".canonical/collection-inventory.json";
const INVENTORY_INTERVAL_MS = 24 * 60 * 60 * 1000;
const COUNTERS = [
  "agentTurns",
  "scopesCreated",
  "scopesCompleted",
  "scopesCancelled",
  "checksRun",
] as const;
type CounterKey = (typeof COUNTERS)[number];
type Session = { sessionId: string; startedAt: string } & { [K in CounterKey]: number };
function emptySession(now: Date): Session {
  return {
    sessionId: randomUUID(),
    startedAt: now.toISOString(),
    agentTurns: 0,
    scopesCreated: 0,
    scopesCompleted: 0,
    scopesCancelled: 0,
    checksRun: 0,
  };
}
function readSession(root: string): Session | undefined {
  const path = join(root, SESSION_REL);
  if (!existsSync(path)) {
    return undefined;
  }
  try {
    const o = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    if (typeof o.sessionId !== "string" || typeof o.startedAt !== "string") {
      return undefined;
    }
    const next: Record<string, string | number> = {
      sessionId: o.sessionId,
      startedAt: o.startedAt,
    };
    for (const key of COUNTERS) {
      next[key] = typeof o[key] === "number" ? (o[key] as number) : 0;
    }
    return next as Session;
  } catch {
    return undefined;
  }
}
export function bump(root: string, key: CounterKey): Session | undefined {
  if (!hasUsageConsent(root)) {
    return undefined;
  }
  const session = readSession(root) ?? emptySession(new Date());
  const next = { ...session, [key]: session[key] + 1 };
  atomicWriteJson(root, SESSION_REL, next);
  return next;
}
export function shouldEmitInventory(root: string, now: Date = new Date()): boolean {
  const path = join(root, INVENTORY_REL);
  if (!existsSync(path)) {
    return true;
  }
  try {
    const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
    const at =
      raw !== null && typeof raw === "object"
        ? (raw as Record<string, unknown>).lastInventoryEmittedAt
        : undefined;
    return typeof at !== "number" || now.getTime() - at >= INVENTORY_INTERVAL_MS;
  } catch {
    return true;
  }
}
export function markInventoryEmitted(root: string, now: Date = new Date()): void {
  atomicWriteJson(root, INVENTORY_REL, { lastInventoryEmittedAt: now.getTime() });
}
export function buildSessionSummaryDimensions(
  root: string,
  now: Date = new Date(),
): UsageDimensions | undefined {
  const session = readSession(root);
  if (session === undefined) {
    return undefined;
  }
  const duration = bucketDurationHours(session.startedAt, now);
  const dims: Record<string, string | number | boolean> = {
    agent_turns_bucket: bucketAgentTurns(session.agentTurns),
    scopes_created: session.scopesCreated,
    scopes_completed: session.scopesCompleted,
    scopes_cancelled: session.scopesCancelled,
    checks_run: session.checksRun,
  };
  if (duration !== undefined) {
    dims.duration_bucket = duration;
  }
  return dims;
}
export function clearSession(root: string): void {
  try {
    rmSync(join(root, SESSION_REL), { force: true });
  } catch {}
}
