import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteJson } from "../fs/contained-write.js";
import type { UsageDimensions } from "./emit.js";
import { bucketAgentTurns, bucketDurationHours } from "./metric-dimensions.js";
import { hasUsageConsent, readCollectionFile } from "./storage.js";

/** Gitignored session counters for agent_turns_bucket / session_summary (#9). */
export const SESSION_FILE_REL = ".canonical/collection-session.json";

const INVENTORY_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface CollectionSession {
  readonly sessionId: string;
  readonly startedAt: string;
  readonly agentTurns: number;
  readonly scopesCreated: number;
  readonly scopesCompleted: number;
  readonly scopesCancelled: number;
  readonly consentPrompts: number;
  readonly checksRun: number;
}

function sessionPath(projectRoot: string): string {
  return join(projectRoot, SESSION_FILE_REL);
}

function parseSession(raw: unknown): CollectionSession | undefined {
  if (raw === null || typeof raw !== "object") {
    return undefined;
  }
  const o = raw as Record<string, unknown>;
  if (typeof o.sessionId !== "string" || typeof o.startedAt !== "string") {
    return undefined;
  }
  return {
    sessionId: o.sessionId,
    startedAt: o.startedAt,
    agentTurns: typeof o.agentTurns === "number" ? o.agentTurns : 0,
    scopesCreated: typeof o.scopesCreated === "number" ? o.scopesCreated : 0,
    scopesCompleted: typeof o.scopesCompleted === "number" ? o.scopesCompleted : 0,
    scopesCancelled: typeof o.scopesCancelled === "number" ? o.scopesCancelled : 0,
    consentPrompts: typeof o.consentPrompts === "number" ? o.consentPrompts : 0,
    checksRun: typeof o.checksRun === "number" ? o.checksRun : 0,
  };
}

export function readSession(projectRoot: string): CollectionSession | undefined {
  const path = sessionPath(projectRoot);
  if (!existsSync(path)) {
    return undefined;
  }
  try {
    return parseSession(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return undefined;
  }
}

export function writeSession(projectRoot: string, session: CollectionSession): void {
  atomicWriteJson(projectRoot, SESSION_FILE_REL, session);
}

/** Ensure a session exists; create with fresh sessionId when absent. */
export function ensureSession(projectRoot: string, now: Date = new Date()): CollectionSession {
  const existing = readSession(projectRoot);
  if (existing !== undefined) {
    return existing;
  }
  const session: CollectionSession = {
    sessionId: randomUUID(),
    startedAt: now.toISOString(),
    agentTurns: 0,
    scopesCreated: 0,
    scopesCompleted: 0,
    scopesCancelled: 0,
    consentPrompts: 0,
    checksRun: 0,
  };
  writeSession(projectRoot, session);
  return session;
}

function mutateSession(
  projectRoot: string,
  mutator: (session: CollectionSession) => CollectionSession,
): CollectionSession | undefined {
  // Do not persist activity while metrics are declined/undecided — otherwise a
  // later opt-in session_summary would ship pre-consent counters.
  if (!hasUsageConsent(readCollectionFile(projectRoot))) {
    return undefined;
  }
  const session = ensureSession(projectRoot);
  const next = mutator(session);
  writeSession(projectRoot, next);
  return next;
}

/** Increment agent turn counter (agents call via documented bump rule). */
export function bumpAgentTurn(projectRoot: string): CollectionSession | undefined {
  return mutateSession(projectRoot, (s) => ({ ...s, agentTurns: s.agentTurns + 1 }));
}

export function recordScopeCreated(projectRoot: string): CollectionSession | undefined {
  return mutateSession(projectRoot, (s) => ({ ...s, scopesCreated: s.scopesCreated + 1 }));
}

export function recordScopeCompleted(projectRoot: string): CollectionSession | undefined {
  return mutateSession(projectRoot, (s) => ({ ...s, scopesCompleted: s.scopesCompleted + 1 }));
}

export function recordScopeCancelled(projectRoot: string): CollectionSession | undefined {
  return mutateSession(projectRoot, (s) => ({ ...s, scopesCancelled: s.scopesCancelled + 1 }));
}

export function recordCheckRun(projectRoot: string): CollectionSession | undefined {
  return mutateSession(projectRoot, (s) => ({ ...s, checksRun: s.checksRun + 1 }));
}

export function recordConsentPrompt(projectRoot: string): CollectionSession | undefined {
  return mutateSession(projectRoot, (s) => ({ ...s, consentPrompts: s.consentPrompts + 1 }));
}

/** Survives session_summary clears so the 24h inventory throttle stays intact. */
export const INVENTORY_FILE_REL = ".canonical/collection-inventory.json";

function inventoryPath(projectRoot: string): string {
  return join(projectRoot, INVENTORY_FILE_REL);
}

function readInventoryEmittedAt(projectRoot: string): number | undefined {
  const path = inventoryPath(projectRoot);
  if (!existsSync(path)) {
    return undefined;
  }
  try {
    const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (raw !== null && typeof raw === "object") {
      const at = (raw as Record<string, unknown>).lastInventoryEmittedAt;
      return typeof at === "number" ? at : undefined;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

/** True when xbrief_inventory has not been emitted in the last 24h. */
export function shouldEmitInventory(projectRoot: string, now: Date = new Date()): boolean {
  const at = readInventoryEmittedAt(projectRoot);
  if (at === undefined) {
    return true;
  }
  return now.getTime() - at >= INVENTORY_INTERVAL_MS;
}

export function markInventoryEmitted(projectRoot: string, now: Date = new Date()): void {
  atomicWriteJson(projectRoot, INVENTORY_FILE_REL, { lastInventoryEmittedAt: now.getTime() });
}

/** Build session_summary dimensions from persisted counters. */
export function buildSessionSummaryDimensions(
  projectRoot: string,
  now: Date = new Date(),
): UsageDimensions | undefined {
  const session = readSession(projectRoot);
  if (session === undefined) {
    return undefined;
  }
  const duration = bucketDurationHours(session.startedAt, now);
  const dims: Record<string, string | number | boolean> = {
    agent_turns_bucket: bucketAgentTurns(session.agentTurns),
    scopes_created: session.scopesCreated,
    scopes_completed: session.scopesCompleted,
    scopes_cancelled: session.scopesCancelled,
    consent_prompts: session.consentPrompts,
    checks_run: session.checksRun,
  };
  if (duration !== undefined) {
    dims.duration_bucket = duration;
  }
  return dims;
}

/** Clear session counters after session_summary emission. */
export function clearSession(projectRoot: string): void {
  try {
    rmSync(sessionPath(projectRoot), { force: true });
  } catch {
    // best-effort
  }
}
