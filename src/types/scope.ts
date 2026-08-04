import type { ScopeStatus } from "./status.js";

/** Scope file shape (content/state.md "Scope Files"). */

export const SCOPE_KINDS = ["story", "epic", "chore"] as const;
export type ScopeKind = (typeof SCOPE_KINDS)[number];

export const REFERENCE_TYPES = ["issue", "pr", "scope", "spec", "user-request"] as const;
export type ReferenceType = (typeof REFERENCE_TYPES)[number];

export const TRUST_LEVELS = ["verified", "internal", "external"] as const;
export type TrustLevel = (typeof TRUST_LEVELS)[number];

export interface ScopeReference {
  readonly uri: string;
  readonly type: ReferenceType;
  readonly title?: string;
  readonly trust: TrustLevel;
}

export interface AcceptanceItem {
  readonly id: string;
  readonly text: string;
  readonly done: boolean;
}

export interface ScopePlan {
  readonly status: ScopeStatus;
  readonly created: string;
  readonly updated: string;
}

export const SWARM_READINESS = ["ready", "blocked", "unset"] as const;
export type SwarmReadiness = (typeof SWARM_READINESS)[number];

export interface SwarmBlock {
  readonly file_scope: readonly string[];
  readonly verify_commands: readonly string[];
  readonly readiness: SwarmReadiness;
}

export const DELIVERY_DISPOSITIONS = [
  "delivered",
  "accepted_not_delivered",
  "superseded",
  "experiment_archived",
] as const;
export type DeliveryDisposition = (typeof DELIVERY_DISPOSITIONS)[number];

export interface DeliveryBlock {
  readonly disposition: DeliveryDisposition;
  readonly pr?: string;
  readonly sha?: string;
  readonly branch?: string;
}

/** Canonical narrative keys tooling reads by name (content/state.md). */
export interface ScopeNarratives {
  readonly Description?: string;
  readonly Acceptance?: string;
  readonly Traces?: string;
  readonly Origin?: string;
  readonly [key: string]: string | undefined;
}

export interface ScopeFile {
  readonly title: string;
  readonly kind: ScopeKind;
  readonly plan: ScopePlan;
  readonly narratives?: ScopeNarratives;
  readonly items?: readonly AcceptanceItem[];
  readonly dependencies?: readonly string[];
  readonly references?: readonly ScopeReference[];
  readonly swarm?: SwarmBlock;
  readonly delivery?: DeliveryBlock;
}

/** briefs/ layout constants (content/state.md Layout). */
export const BRIEFS_DIR = "briefs";
export const PROJECT_BRIEF_NAME = "PROJECT.json";
export const SPEC_BRIEF_NAME = "spec.json";
export const PLAN_BRIEF_NAME = "plan.json";
export const CONTINUE_BRIEF_NAME = "continue.json";
export const AUDIT_LOG_NAME = "audit.jsonl";
