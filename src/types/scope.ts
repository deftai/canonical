import type { ScopeStatus } from "./status.js";

/**
 * Scope document shape: an xBRIEF v0.8 document (content/state.md "Scope
 * Files"; spec + schema in third_party/xBRIEF). Canonical-specific fields
 * ride in the `x-canonical/` extension namespace (spec section 7); unknown
 * `x-<token>/` properties MUST round-trip untouched.
 */

export const XBRIEF_VERSION = "0.8";

export const SCOPE_KINDS = ["story", "epic", "chore"] as const;
export type ScopeKind = (typeof SCOPE_KINDS)[number];

/** Reference types canonical emits. `x-xbrief/*` values are spec-administered (spec Appendix B). */
export const REFERENCE_TYPES = [
  "x-xbrief/github-issue",
  "x-xbrief/github-pr",
  "x-xbrief/plan",
  "x-canonical/user-request",
] as const;
export type ReferenceType = (typeof REFERENCE_TYPES)[number];

/** The full spec-administered `x-xbrief/` reference type registry (closed set). */
export const XBRIEF_REFERENCE_REGISTRY = [
  "x-xbrief/plan",
  "x-xbrief/github-issue",
  "x-xbrief/github-pr",
  "x-xbrief/commit",
  "x-xbrief/external",
  "x-xbrief/research",
  "x-xbrief/adr",
] as const;

/** references[].type MUST match this pattern (spec VBriefReference). */
export const REFERENCE_TYPE_RE = /^x-[a-zA-Z0-9_-]+\//;

export const TRUST_LEVELS = ["verified", "internal", "external"] as const;
export type TrustLevel = (typeof TRUST_LEVELS)[number];

export interface ScopeReference {
  readonly uri: string;
  readonly type: string;
  readonly title?: string;
  readonly "x-canonical/trust"?: TrustLevel;
  readonly [key: string]: unknown;
}

/** Acceptance criterion as a spec PlanItem; canonical uses only pending|completed. */
export interface AcceptanceItem {
  readonly id: string;
  readonly title: string;
  readonly status: "pending" | "completed";
  readonly [key: string]: unknown;
}

export const SWARM_READINESS = ["ready", "blocked", "unset"] as const;
export type SwarmReadiness = (typeof SWARM_READINESS)[number];

export interface SwarmBlock {
  readonly filesScope: readonly string[];
  readonly verifyCommands: readonly string[];
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
  readonly Note?: string;
  readonly [key: string]: string | undefined;
}

export interface ScopePlan {
  readonly title: string;
  readonly status: ScopeStatus;
  readonly created: string;
  readonly updated: string;
  readonly items: readonly AcceptanceItem[];
  readonly narratives?: ScopeNarratives;
  readonly references?: readonly ScopeReference[];
  readonly "x-canonical/kind"?: ScopeKind;
  readonly "x-canonical/dependencies"?: readonly string[];
  readonly "x-canonical/swarm"?: SwarmBlock;
  readonly "x-canonical/delivery"?: DeliveryBlock;
  readonly [key: string]: unknown;
}

export interface XbriefInfo {
  readonly version: string;
  readonly [key: string]: unknown;
}

/** A scope file on disk: xBRIEF envelope + plan. Index signatures carry foreign `x-<token>/` extras. */
export interface ScopeDoc {
  readonly xBRIEFInfo: XbriefInfo;
  readonly plan: ScopePlan;
  readonly [key: string]: unknown;
}

/* Accessors for extension-namespaced fields (keeps bracket keys out of call sites). */

export function scopeKind(doc: ScopeDoc): ScopeKind | undefined {
  return doc.plan["x-canonical/kind"];
}

export function scopeDependencies(doc: ScopeDoc): readonly string[] {
  return doc.plan["x-canonical/dependencies"] ?? [];
}

export function scopeSwarm(doc: ScopeDoc): SwarmBlock | undefined {
  return doc.plan["x-canonical/swarm"];
}

export function scopeDelivery(doc: ScopeDoc): DeliveryBlock | undefined {
  return doc.plan["x-canonical/delivery"];
}

/** Copy of `doc` with `fields` merged into its plan (envelope + foreign keys preserved). */
export function withPlan(doc: ScopeDoc, fields: Partial<ScopePlan>): ScopeDoc {
  return { ...doc, plan: { ...doc.plan, ...fields } };
}

/** xbrief/ layout constants (content/state.md Layout). */
export const XBRIEF_DIR = "xbrief";
export const PROJECT_BRIEF_NAME = "PROJECT.xbrief.json";
export const SPEC_BRIEF_NAME = "spec.xbrief.json";
export const PLAN_BRIEF_NAME = "plan.xbrief.json";
export const CONTINUE_BRIEF_NAME = "continue.xbrief.json";
export const AUDIT_LOG_NAME = "audit.jsonl";
