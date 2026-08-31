import { chmodSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { CredentialStorage, StoredCredentials } from "@deft/collection-sdk";
import { atomicWriteJson } from "../fs/contained-write.js";
import {
  COLLECTION_FILE_REL,
  type CollectionFile,
  type CollectionPromptState,
  type ConsentMirror,
  type ConsentSignal,
  type ContactIdentity,
  type IdentityState,
  identityMode,
  isMetricsMode,
  type MetricsMode,
  type MetricsState,
  SUBMISSION_SCOPES,
  type SubmissionsMirror,
  type SubmissionsState,
} from "./types.js";

/**
 * Project-local collection file: SDK credentials + consent mirrors.
 * Path: `.canonical/collection.json` (gitignored).
 */

export function collectionFilePath(projectRoot: string): string {
  return join(projectRoot, COLLECTION_FILE_REL);
}

function isConsentMirror(value: unknown): value is ConsentMirror {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const v = value as Record<string, unknown>;
  return (
    (v.decision === "active" || v.decision === "declined" || v.decision === "revoked") &&
    Array.isArray(v.scopes) &&
    typeof v.consentVersion === "string" &&
    typeof v.decidedAt === "string"
  );
}

function isSubmissionsMirror(value: unknown): value is SubmissionsMirror {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const v = value as Record<string, unknown>;
  return typeof v.granted === "boolean";
}

function isContactIdentity(value: unknown): value is ContactIdentity {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const v = value as Record<string, unknown>;
  for (const key of ["firstName", "lastName", "email", "mobile"] as const) {
    if (v[key] !== undefined && typeof v[key] !== "string") {
      return false;
    }
  }
  return true;
}

function parseCollectionFile(raw: unknown): CollectionFile {
  if (raw === null || typeof raw !== "object") {
    return {};
  }
  const o = raw as Record<string, unknown>;
  const file: CollectionFile = {
    ...(typeof o.installId === "string" ? { installId: o.installId } : {}),
    ...(typeof o.token === "string" ? { token: o.token } : {}),
    ...(isConsentMirror(o.metrics) ? { metrics: o.metrics } : {}),
    ...(isMetricsMode(o.metricsMode) ? { metricsMode: o.metricsMode } : {}),
    ...(isSubmissionsMirror(o.submissions) ? { submissions: o.submissions } : {}),
    ...(isContactIdentity(o.identity) ? { identity: o.identity } : {}),
    ...(isConsentMirror(o.consent) ? { consent: o.consent } : {}),
  };
  return file;
}

function legacyHasAllScopes(scopes: readonly string[]): boolean {
  return scopes.includes("usage") && SUBMISSION_SCOPES.every((s) => scopes.includes(s));
}

/**
 * Migrate pre-C4 `consent` mirror into metrics + submissions.
 * Legacy active with all four scopes → metrics=active + submissions=granted.
 */
export function migrateCollectionFile(file: CollectionFile): {
  readonly file: CollectionFile;
  readonly migrated: boolean;
} {
  if (file.metrics !== undefined || file.submissions !== undefined) {
    // Already C4-shaped; drop legacy consent from the normalized view.
    if (file.consent === undefined) {
      return { file, migrated: false };
    }
    const { consent: _legacy, ...rest } = file;
    return { file: rest, migrated: true };
  }

  const legacy = file.consent;
  if (legacy === undefined) {
    return { file, migrated: false };
  }

  const scopes = legacy.scopes ?? [];
  const base: CollectionFile = {
    ...(file.installId !== undefined ? { installId: file.installId } : {}),
    ...(file.token !== undefined ? { token: file.token } : {}),
    ...(file.identity !== undefined ? { identity: file.identity } : {}),
    ...(file.metricsMode !== undefined ? { metricsMode: file.metricsMode } : {}),
  };

  if (legacy.decision === "active" && legacyHasAllScopes(scopes)) {
    const metricsMode: MetricsMode =
      identityMode(file.identity) === "identified" ? "attributed" : "anonymous";
    return {
      file: {
        ...base,
        metricsMode,
        metrics: {
          decision: "active",
          scopes: ["usage"],
          consentVersion: legacy.consentVersion,
          decidedAt: legacy.decidedAt,
          ...(legacy.expiresAt !== undefined ? { expiresAt: legacy.expiresAt } : {}),
        },
        submissions: {
          granted: true,
          scopes: [...SUBMISSION_SCOPES],
          consentVersion: legacy.consentVersion,
          decidedAt: legacy.decidedAt,
          ...(legacy.expiresAt !== undefined ? { expiresAt: legacy.expiresAt } : {}),
        },
      },
      migrated: true,
    };
  }

  if (legacy.decision === "active") {
    const hasUsage = scopes.includes("usage");
    const submissionScopes = SUBMISSION_SCOPES.filter((s) => scopes.includes(s));
    const metricsMode: MetricsMode = hasUsage
      ? identityMode(file.identity) === "identified"
        ? "attributed"
        : "anonymous"
      : "disallowed";
    return {
      file: {
        ...base,
        metricsMode,
        ...(hasUsage
          ? {
              metrics: {
                decision: "active" as const,
                scopes: ["usage"],
                consentVersion: legacy.consentVersion,
                decidedAt: legacy.decidedAt,
                ...(legacy.expiresAt !== undefined ? { expiresAt: legacy.expiresAt } : {}),
              },
            }
          : {
              metrics: {
                decision: "declined" as const,
                scopes: [],
                consentVersion: legacy.consentVersion,
                decidedAt: legacy.decidedAt,
              },
            }),
        submissions: {
          granted: submissionScopes.length > 0,
          ...(submissionScopes.length > 0
            ? {
                scopes: submissionScopes,
                consentVersion: legacy.consentVersion,
                decidedAt: legacy.decidedAt,
                ...(legacy.expiresAt !== undefined ? { expiresAt: legacy.expiresAt } : {}),
              }
            : {}),
        },
      },
      migrated: true,
    };
  }

  // declined / revoked → metrics only; submissions not granted
  return {
    file: {
      ...base,
      metricsMode: "disallowed",
      metrics: {
        decision: legacy.decision,
        scopes: [],
        consentVersion: legacy.consentVersion,
        decidedAt: legacy.decidedAt,
      },
      submissions: { granted: false },
    },
    migrated: true,
  };
}

export function readCollectionFile(projectRoot: string): CollectionFile {
  const path = collectionFilePath(projectRoot);
  if (!existsSync(path)) {
    return {};
  }
  let parsed: CollectionFile = {};
  try {
    parsed = parseCollectionFile(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return {};
  }
  const { file, migrated } = migrateCollectionFile(parsed);
  if (migrated) {
    try {
      writeCollectionFile(projectRoot, file);
    } catch {
      // best-effort persist; still return migrated view
    }
  }
  return file;
}

function chmodSecret(projectRoot: string): void {
  try {
    chmodSync(collectionFilePath(projectRoot), 0o600);
  } catch {
    // best-effort
  }
}

export function writeCollectionFile(projectRoot: string, file: CollectionFile): void {
  // Never persist legacy `consent` on new writes.
  const { consent: _legacy, ...rest } = file;
  atomicWriteJson(projectRoot, COLLECTION_FILE_REL, rest);
  chmodSecret(projectRoot);
}

export function writeMetricsMirror(
  projectRoot: string,
  metrics: ConsentMirror,
  metricsMode?: MetricsMode,
): void {
  const existing = readCollectionFile(projectRoot);
  const mode =
    metricsMode ??
    deriveMetricsMode({
      ...existing,
      metrics,
    });
  writeCollectionFile(projectRoot, { ...existing, metrics, metricsMode: mode });
}

/** @deprecated Prefer writeMetricsMirror — kept for call-site compatibility during C4. */
export function writeConsentMirror(projectRoot: string, consent: ConsentMirror): void {
  writeMetricsMirror(projectRoot, consent);
}

export function writeSubmissionsMirror(projectRoot: string, submissions: SubmissionsMirror): void {
  const existing = readCollectionFile(projectRoot);
  writeCollectionFile(projectRoot, { ...existing, submissions });
}

export function writeMetricsMode(projectRoot: string, metricsMode: MetricsMode): void {
  const existing = readCollectionFile(projectRoot);
  writeCollectionFile(projectRoot, { ...existing, metricsMode });
}

export function writeIdentityMirror(
  projectRoot: string,
  identity: ContactIdentity | undefined,
): void {
  const existing = readCollectionFile(projectRoot);
  if (identity === undefined) {
    const { identity: _drop, ...rest } = existing;
    const withoutIdentity: CollectionFile = rest;
    writeCollectionFile(projectRoot, {
      ...withoutIdentity,
      metricsMode: deriveMetricsMode(withoutIdentity),
    });
    return;
  }
  const next: CollectionFile = { ...existing, identity };
  writeCollectionFile(projectRoot, {
    ...next,
    metricsMode: deriveMetricsMode(next),
  });
}

export function clearCredentialsKeepConsent(
  projectRoot: string,
  metrics?: ConsentMirror,
  submissions?: SubmissionsMirror,
  metricsMode: MetricsMode = "disallowed",
): void {
  const existing = readCollectionFile(projectRoot);
  const next: CollectionFile = {
    metrics: metrics ?? existing.metrics,
    submissions: submissions ?? existing.submissions,
    metricsMode,
    // Full opt-out path intentionally omits identity + credentials (rotate install).
  };
  writeCollectionFile(projectRoot, next);
}

/** CredentialStorage adapter over the project collection file (installId + token only). */
export function projectCredentialStorage(projectRoot: string): CredentialStorage {
  return {
    async load(): Promise<StoredCredentials | null> {
      const file = readCollectionFile(projectRoot);
      if (
        typeof file.installId === "string" &&
        file.installId.length > 0 &&
        typeof file.token === "string" &&
        file.token.length > 0
      ) {
        return { installId: file.installId, token: file.token };
      }
      return null;
    },
    async save(creds: StoredCredentials): Promise<void> {
      const existing = readCollectionFile(projectRoot);
      writeCollectionFile(projectRoot, {
        ...existing,
        installId: creds.installId,
        token: creds.token,
      });
    },
    async clear(): Promise<void> {
      const existing = readCollectionFile(projectRoot);
      const next: CollectionFile = {
        ...(existing.metrics !== undefined ? { metrics: existing.metrics } : {}),
        ...(existing.metricsMode !== undefined ? { metricsMode: existing.metricsMode } : {}),
        ...(existing.submissions !== undefined ? { submissions: existing.submissions } : {}),
        ...(existing.identity !== undefined ? { identity: existing.identity } : {}),
      };
      writeCollectionFile(projectRoot, next);
    },
  };
}

function metricsStateFromMirror(mirror: ConsentMirror | undefined, nowMs: number): MetricsState {
  if (mirror === undefined) {
    return "not_prompted";
  }
  if (mirror.decision === "declined") {
    return "declined";
  }
  if (mirror.decision === "revoked") {
    return "revoked";
  }
  if (mirror.decision === "active") {
    if (typeof mirror.expiresAt === "number" && mirror.expiresAt > 0 && mirror.expiresAt <= nowMs) {
      return "expired";
    }
    return "active";
  }
  return "not_prompted";
}

/** Derive plain-English metricsMode from mirrors + identity. */
export function deriveMetricsMode(file: CollectionFile, nowMs: number = Date.now()): MetricsMode {
  const metrics = metricsStateFromMirror(file.metrics, nowMs);
  if (metrics === "not_prompted" || metrics === "expired") {
    return "undecided";
  }
  if (metrics === "declined" || metrics === "revoked") {
    return "disallowed";
  }
  if (metrics === "active") {
    return identityMode(file.identity) === "identified" ? "attributed" : "anonymous";
  }
  return "undecided";
}

/**
 * Resolve metricsMode: prefer persisted value when it matches decision/identity;
 * otherwise derive (and callers may re-persist).
 */
export function resolveMetricsMode(file: CollectionFile, nowMs: number = Date.now()): MetricsMode {
  const derived = deriveMetricsMode(file, nowMs);
  const persisted = file.metricsMode;
  if (persisted === undefined) {
    return derived;
  }
  // Sticky disallowed when declined/revoked even if identity still present briefly.
  if (derived === "disallowed") {
    return "disallowed";
  }
  // Active metrics: identity wins between anonymous/attributed.
  if (derived === "anonymous" || derived === "attributed") {
    return derived;
  }
  // Expired / never-prompted: do not keep a stale persisted anonymous|attributed mode.
  if (derived === "undecided") {
    return "undecided";
  }
  return persisted;
}

function submissionsStateFromMirror(
  mirror: SubmissionsMirror | undefined,
  nowMs: number,
): SubmissionsState {
  if (mirror === undefined || mirror.granted !== true) {
    return "not_granted";
  }
  if (typeof mirror.expiresAt === "number" && mirror.expiresAt > 0 && mirror.expiresAt <= nowMs) {
    return "not_granted";
  }
  return "granted";
}

export function resolveConsentSignal(
  file: CollectionFile,
  nowMs: number = Date.now(),
): ConsentSignal {
  const identity: IdentityState = identityMode(file.identity);
  return {
    metrics: metricsStateFromMirror(file.metrics, nowMs),
    metricsMode: resolveMetricsMode(file, nowMs),
    submissions: submissionsStateFromMirror(file.submissions, nowMs),
    identity,
    identityMode: identity,
  };
}

export function formatConsentSignal(file: CollectionFile, nowMs: number = Date.now()): string {
  const s = resolveConsentSignal(file, nowMs);
  return `metricsMode=${s.metricsMode} metrics=${s.metrics} submissions=${s.submissions} identity=${s.identity}`;
}

/** Metrics-only prompt state (compat for callers that still ask for a single state). */
export function localPromptState(
  file: CollectionFile,
  nowMs: number = Date.now(),
): CollectionPromptState {
  return resolveConsentSignal(file, nowMs).metrics;
}

export function hasUsageConsent(file: CollectionFile, nowMs: number = Date.now()): boolean {
  if (resolveConsentSignal(file, nowMs).metrics !== "active") {
    return false;
  }
  return (file.metrics?.scopes ?? []).includes("usage");
}

export function hasSubmissionsGrant(file: CollectionFile, nowMs: number = Date.now()): boolean {
  return resolveConsentSignal(file, nowMs).submissions === "granted";
}

export function hasScopeConsent(
  file: CollectionFile,
  scope: string,
  nowMs: number = Date.now(),
): boolean {
  if (scope === "usage") {
    return hasUsageConsent(file, nowMs);
  }
  if (!hasSubmissionsGrant(file, nowMs)) {
    return false;
  }
  const scopes = file.submissions?.scopes;
  if (scopes === undefined || scopes.length === 0) {
    // granted without explicit scopes → all submission scopes allowed
    return (SUBMISSION_SCOPES as readonly string[]).includes(scope);
  }
  return scopes.includes(scope);
}
