/**
 * Local collection/consent types for Canonical × @deft/collection-sdk.
 * Credentials live in `.canonical/collection.json` (gitignored); the anonymous
 * correlator (`userKey` in identity.json) lives under `~/.config/canonical/`.
 */

export const COLLECTION_FILE_REL = ".canonical/collection.json";

/** Pinned consent text version — bump when the user-facing consent copy changes. */
export const CONSENT_VERSION = "canonical-2026-09-b";

/** Metrics opt-in scopes (usage counters only). */
export const METRICS_SCOPES = ["usage"] as const;

/** Submission scopes granted only after disclosure. */
export const SUBMISSION_SCOPES = ["feedback", "bug", "feature"] as const;

/** Default for `collection:opt-in --confirm` — metrics only, not all scopes. */
export const DEFAULT_SCOPES = METRICS_SCOPES;

export type CollectionScope = (typeof METRICS_SCOPES)[number] | (typeof SUBMISSION_SCOPES)[number];

export type ConsentDecision = "active" | "declined" | "revoked";

/**
 * Plain-English metrics mode persisted for agents.
 * undecided = never prompted / expired; disallowed = decline or opt-out;
 * anonymous = usage only; attributed = usage + reply-channel identity.
 */
export type MetricsMode = "undecided" | "disallowed" | "anonymous" | "attributed";

/** Offline-fast local mirror of metrics consent; authoritative server state via SDK status(). */
export interface ConsentMirror {
  readonly decision: ConsentDecision;
  readonly scopes: readonly string[];
  readonly consentVersion: string;
  readonly expiresAt?: number;
  readonly decidedAt: string;
}

/** Local submissions disclosure grant — independent of metrics. */
export interface SubmissionsMirror {
  readonly granted: boolean;
  readonly scopes?: readonly string[];
  readonly consentVersion?: string;
  readonly decidedAt?: string;
  readonly expiresAt?: number;
}

/** Optional reply-channel identity (PRIV-2: never copied into event payloads). */
export interface ContactIdentity {
  readonly firstName?: string;
  readonly lastName?: string;
  readonly email?: string;
  readonly mobile?: string;
}

/** On-disk project collection state (credentials + consent mirrors). */
export interface CollectionFile {
  readonly installId?: string;
  readonly token?: string;
  /** Metrics (usage) consent — primary after C4. */
  readonly metrics?: ConsentMirror;
  /**
   * Explicit tri-state for agents (Disallow / Anonymous / Attributed).
   * Written on decline / opt-in / identity / opt-out; derived when absent.
   */
  readonly metricsMode?: MetricsMode;
  /** Submissions disclosure grant. */
  readonly submissions?: SubmissionsMirror;
  /** Local contact identity (C5); mode identified requires email or mobile. */
  readonly identity?: ContactIdentity;
  /**
   * Legacy pre-C4 single mirror. Read-compat only; migrated to metrics +
   * submissions on read. New writes omit this field.
   */
  readonly consent?: ConsentMirror;
}

/** Deterministic metrics signal for agents (orient / status). */
export type CollectionPromptState = "not_prompted" | "declined" | "active" | "revoked" | "expired";

export type MetricsState = CollectionPromptState;
export type SubmissionsState = "not_granted" | "granted";
/** Anonymous unless local identity has email or mobile. */
export type IdentityState = "anonymous" | "identified";

/** identified requires at least one of email or mobile; name-only stays anonymous. */
export function identityMode(identity: ContactIdentity | undefined): IdentityState {
  if (identity === undefined) {
    return "anonymous";
  }
  const email = identity.email?.trim();
  const mobile = identity.mobile?.trim();
  if ((email !== undefined && email.length > 0) || (mobile !== undefined && mobile.length > 0)) {
    return "identified";
  }
  return "anonymous";
}

export function isMetricsMode(value: unknown): value is MetricsMode {
  return (
    value === "undecided" ||
    value === "disallowed" ||
    value === "anonymous" ||
    value === "attributed"
  );
}

export interface ConsentSignal {
  readonly metrics: MetricsState;
  readonly metricsMode: MetricsMode;
  readonly submissions: SubmissionsState;
  readonly identity: IdentityState;
  /** Alias of identity for pack/agents. */
  readonly identityMode: IdentityState;
}

export const DEFAULT_COLLECTION_BASE_URL = "https://api.deft-staging.co/collector";
export const DEFAULT_COLLECTION_ENV = "staging";
