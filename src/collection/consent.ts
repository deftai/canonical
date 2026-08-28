import type { Collector } from "@deft/collection-sdk";
import { type CreateCanonicalCollectorOptions, createCanonicalCollector } from "./client.js";
import { clearIdentityAndServerContact, dropLocalIdentity } from "./contact-identity.js";
import {
  clearCredentialsKeepConsent,
  formatConsentSignal,
  localPromptState,
  readCollectionFile,
  resolveConsentSignal,
  writeCollectionFile,
  writeMetricsMirror,
  writeSubmissionsMirror,
} from "./storage.js";
import {
  CONSENT_VERSION,
  type CollectionPromptState,
  type ConsentMirror,
  type ConsentSignal,
  DEFAULT_SCOPES,
  type IdentityState,
  METRICS_SCOPES,
  type MetricsState,
  SUBMISSION_SCOPES,
  type SubmissionsState,
} from "./types.js";

export interface CollectionStatus {
  readonly promptState: CollectionPromptState;
  readonly metrics: MetricsState;
  readonly submissions: SubmissionsState;
  readonly identity: IdentityState;
  readonly scopes: readonly string[];
  readonly consentVersion?: string;
  readonly expiresAt?: number;
  readonly installId?: string;
  readonly liveState?: string;
}

export interface StatusOptions extends CreateCanonicalCollectorOptions {
  /** When true, call SDK status() for live server state (needs network + credentials). */
  readonly live?: boolean;
  readonly collector?: Collector;
  readonly nowMs?: number;
}

export { formatConsentSignal, resolveConsentSignal };

export async function collectionStatus(
  projectRoot: string,
  opts: StatusOptions = {},
): Promise<{
  readonly code: 0 | 1 | 2;
  readonly status: CollectionStatus;
  readonly message: string;
}> {
  const file = readCollectionFile(projectRoot);
  let signal = resolveConsentSignal(file, opts.nowMs);
  let scopes: readonly string[] = [
    ...(file.metrics?.scopes ?? []),
    ...(file.submissions?.granted === true
      ? (file.submissions.scopes ?? [...SUBMISSION_SCOPES])
      : []),
  ];
  let consentVersion = file.metrics?.consentVersion ?? file.submissions?.consentVersion;
  let expiresAt = file.metrics?.expiresAt ?? file.submissions?.expiresAt;
  let liveState: string | undefined;

  if (opts.live === true && file.installId !== undefined && file.token !== undefined) {
    try {
      const collector =
        opts.collector ??
        createCanonicalCollector(projectRoot, {
          configDir: opts.configDir,
          baseUrl: opts.baseUrl,
          environment: opts.environment,
          version: opts.version,
          fetch: opts.fetch,
        });
      const live = await collector.status();
      if (live.ok) {
        liveState = live.state;
        if (live.scopes.length > 0) {
          const decidedAt =
            file.metrics?.decidedAt ?? file.submissions?.decidedAt ?? new Date().toISOString();
          const version =
            live.consentVersion ??
            file.metrics?.consentVersion ??
            file.submissions?.consentVersion ??
            CONSENT_VERSION;
          const hasUsage = live.scopes.includes("usage");
          const submissionScopes = SUBMISSION_SCOPES.filter((s) => live.scopes.includes(s));
          const localMetricsDecision = file.metrics?.decision;
          // Local decline/revoke is sticky: --live must not re-activate metrics.
          if (localMetricsDecision === "declined" || localMetricsDecision === "revoked") {
            // leave metrics mirror unchanged
          } else if (hasUsage) {
            writeMetricsMirror(projectRoot, {
              decision: "active",
              scopes: [...METRICS_SCOPES],
              consentVersion: version,
              decidedAt,
              ...(live.expiresAt !== undefined ? { expiresAt: live.expiresAt } : {}),
            });
          } else if (localMetricsDecision === "active") {
            writeMetricsMirror(projectRoot, {
              decision: "revoked",
              scopes: [],
              consentVersion: version,
              decidedAt: new Date().toISOString(),
            });
          }
          if (submissionScopes.length > 0) {
            writeSubmissionsMirror(projectRoot, {
              granted: true,
              scopes: submissionScopes,
              consentVersion: version,
              decidedAt,
              ...(live.expiresAt !== undefined ? { expiresAt: live.expiresAt } : {}),
            });
          } else if (file.submissions?.granted === true) {
            writeSubmissionsMirror(projectRoot, {
              granted: false,
              scopes: [],
              consentVersion: version,
              decidedAt: new Date().toISOString(),
            });
          }
          const refreshed = readCollectionFile(projectRoot);
          signal = resolveConsentSignal(refreshed, opts.nowMs);
          scopes = live.scopes;
          expiresAt = live.expiresAt;
          consentVersion = version;
        }
      }
    } catch {
      // soft — local status still returned
    }
  }

  const status: CollectionStatus = {
    promptState: signal.metrics,
    metrics: signal.metrics,
    submissions: signal.submissions,
    identity: signal.identity,
    scopes,
    consentVersion,
    expiresAt,
    installId: file.installId,
    liveState,
  };
  const code: 0 | 1 = signal.metrics === "active" || signal.submissions === "granted" ? 0 : 1;
  return {
    code,
    status,
    message: `metrics=${signal.metrics} submissions=${signal.submissions} identity=${signal.identity}`,
  };
}

export interface OptInOptions extends CreateCanonicalCollectorOptions {
  readonly scopes?: readonly string[];
  readonly consentVersion?: string;
  readonly confirm: boolean;
  readonly contact?: { email?: string; name?: string; sms?: string };
  readonly collector?: Collector;
  readonly now?: Date;
}

export async function collectionOptIn(
  projectRoot: string,
  opts: OptInOptions,
): Promise<{
  readonly code: 0 | 1 | 2;
  readonly message: string;
  readonly scopes?: readonly string[];
}> {
  if (opts.confirm !== true) {
    return { code: 1, message: "collection:opt-in requires --confirm" };
  }

  const scopes = [...(opts.scopes ?? DEFAULT_SCOPES)];
  if (scopes.length === 0) {
    return { code: 2, message: "collection:opt-in -- scopes must be non-empty" };
  }
  const illegalSubs = scopes.filter((s) => (SUBMISSION_SCOPES as readonly string[]).includes(s));
  if (illegalSubs.length > 0) {
    return {
      code: 2,
      message:
        "collection:opt-in -- submission scopes require feedback disclosure " +
        `(got ${illegalSubs.join(",")}; use feedback --disclosure-accepted)`,
    };
  }
  const consentVersion = opts.consentVersion ?? CONSENT_VERSION;

  try {
    const collector =
      opts.collector ??
      createCanonicalCollector(projectRoot, {
        configDir: opts.configDir,
        baseUrl: opts.baseUrl,
        environment: opts.environment,
        version: opts.version,
        fetch: opts.fetch,
        autoRegister: false,
      });

    const registered = await collector.ensureRegistered();
    if (!registered.ok) {
      return {
        code: registered.code === "not_registered" ? 1 : 2,
        message: `collection:opt-in register failed -- ${registered.code}`,
      };
    }

    // Preserve already-granted submission scopes on the server when metrics opt-in runs.
    const existing = readCollectionFile(projectRoot);
    const priorSubmissions =
      existing.submissions?.granted === true
        ? (existing.submissions.scopes ?? [...SUBMISSION_SCOPES])
        : [];
    const serverScopes = [...new Set([...scopes, ...priorSubmissions])];

    const result = await collector.optIn({
      scopes: serverScopes,
      consentVersion,
      ...(opts.contact !== undefined ? { contact: opts.contact } : {}),
    });
    if (!result.ok) {
      return { code: 1, message: `collection:opt-in rejected -- ${result.code}` };
    }

    const now = opts.now ?? new Date();
    const metricsScopes = result.scopes.filter((s) => s === "usage");
    if (metricsScopes.length === 0) {
      return {
        code: 1,
        message: "collection:opt-in rejected -- server did not grant usage scope",
      };
    }
    const mirror: ConsentMirror = {
      decision: "active",
      scopes: metricsScopes,
      consentVersion,
      expiresAt: result.expiresAt,
      decidedAt: now.toISOString(),
    };
    writeMetricsMirror(projectRoot, mirror);

    return {
      code: 0,
      message: `collection: opted in scopes=[${metricsScopes.join(",")}]`,
      scopes: metricsScopes,
    };
  } catch (err) {
    return {
      code: 2,
      message: `collection:opt-in error -- ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Grant submission scopes after disclosure acceptance. Does not change metrics consent.
 */
export async function grantSubmissions(
  projectRoot: string,
  opts: CreateCanonicalCollectorOptions & {
    readonly collector?: Collector;
    readonly consentVersion?: string;
    readonly now?: Date;
  } = {},
): Promise<{
  readonly code: 0 | 1 | 2;
  readonly message: string;
  readonly scopes?: readonly string[];
}> {
  const consentVersion = opts.consentVersion ?? CONSENT_VERSION;
  const now = opts.now ?? new Date();
  const existing = readCollectionFile(projectRoot);

  try {
    const collector =
      opts.collector ??
      createCanonicalCollector(projectRoot, {
        configDir: opts.configDir,
        baseUrl: opts.baseUrl,
        environment: opts.environment,
        version: opts.version,
        fetch: opts.fetch,
        autoRegister: false,
      });

    const registered = await collector.ensureRegistered();
    if (!registered.ok) {
      return {
        code: registered.code === "not_registered" ? 1 : 2,
        message: `feedback: register failed -- ${registered.code}`,
      };
    }

    const metricsActive = resolveConsentSignal(existing).metrics === "active";
    const serverScopes = metricsActive
      ? [...METRICS_SCOPES, ...SUBMISSION_SCOPES]
      : [...SUBMISSION_SCOPES];

    const result = await collector.optIn({
      scopes: serverScopes,
      consentVersion,
    });
    if (!result.ok) {
      return { code: 1, message: `feedback: submissions opt-in rejected -- ${result.code}` };
    }

    writeSubmissionsMirror(projectRoot, {
      granted: true,
      scopes: [...SUBMISSION_SCOPES],
      consentVersion,
      decidedAt: now.toISOString(),
      expiresAt: result.expiresAt,
    });

    return {
      code: 0,
      message: `feedback: submissions granted scopes=[${SUBMISSION_SCOPES.join(",")}]`,
      scopes: [...SUBMISSION_SCOPES],
    };
  } catch (err) {
    return {
      code: 2,
      message: `feedback: submissions grant error -- ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export interface DeclineOptions {
  readonly now?: Date;
}

export function collectionDecline(
  projectRoot: string,
  opts: DeclineOptions = {},
): { readonly code: 0 | 2; readonly message: string } {
  try {
    const now = opts.now ?? new Date();
    const existing = readCollectionFile(projectRoot);
    const mirror: ConsentMirror = {
      decision: "declined",
      scopes: [],
      consentVersion: CONSENT_VERSION,
      decidedAt: now.toISOString(),
    };
    // Decline metrics only; keep credentials/submissions if present, but drop
    // partial credentials when nothing else is granted yet.
    if (
      existing.submissions?.granted === true ||
      (existing.installId !== undefined && existing.token !== undefined)
    ) {
      writeCollectionFile(projectRoot, {
        ...(existing.installId !== undefined ? { installId: existing.installId } : {}),
        ...(existing.token !== undefined ? { token: existing.token } : {}),
        metrics: mirror,
        ...(existing.submissions !== undefined ? { submissions: existing.submissions } : {}),
        ...(existing.identity !== undefined ? { identity: existing.identity } : {}),
      });
    } else {
      writeCollectionFile(projectRoot, {
        metrics: mirror,
        submissions: { granted: false },
        ...(existing.identity !== undefined ? { identity: existing.identity } : {}),
      });
    }
    return { code: 0, message: "collection: declined (no metrics will be sent)" };
  } catch (err) {
    return {
      code: 2,
      message: `collection:decline error -- ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export interface OptOutOptions extends CreateCanonicalCollectorOptions {
  /** Full revoke + clear credentials. */
  readonly confirm?: boolean;
  /** Clear local identity + server contact only (no metrics/submissions revoke). */
  readonly identity?: boolean;
  readonly collector?: Collector;
  readonly now?: Date;
}

export async function collectionOptOut(
  projectRoot: string,
  opts: OptOutOptions,
): Promise<{ readonly code: 0 | 1 | 2; readonly message: string }> {
  // Identity-only clear (does not revoke metrics/submissions).
  if (opts.identity === true && opts.confirm !== true) {
    const cleared = await clearIdentityAndServerContact(projectRoot, {
      configDir: opts.configDir,
      baseUrl: opts.baseUrl,
      environment: opts.environment,
      version: opts.version,
      fetch: opts.fetch,
      collector: opts.collector,
    });
    return {
      code: cleared.code,
      message:
        cleared.code === 0 ? "collection: identity cleared (opt-out --identity)" : cleared.message,
    };
  }

  if (opts.confirm !== true) {
    return { code: 1, message: "collection:opt-out requires --confirm" };
  }

  const file = readCollectionFile(projectRoot);
  const now = opts.now ?? new Date();
  const revokedMirror: ConsentMirror = {
    decision: "revoked",
    scopes: [],
    consentVersion: file.metrics?.consentVersion ?? CONSENT_VERSION,
    decidedAt: now.toISOString(),
  };
  const revokedSubmissions = {
    granted: false as const,
    decidedAt: now.toISOString(),
    consentVersion: file.submissions?.consentVersion ?? CONSENT_VERSION,
  };

  // No credentials → just mark revoked locally (and drop identity).
  if (file.installId === undefined || file.token === undefined) {
    writeCollectionFile(projectRoot, {
      metrics: revokedMirror,
      submissions: revokedSubmissions,
    });
    return { code: 0, message: "collection: opted out (local only)" };
  }

  try {
    const collector =
      opts.collector ??
      createCanonicalCollector(projectRoot, {
        configDir: opts.configDir,
        baseUrl: opts.baseUrl,
        environment: opts.environment,
        version: opts.version,
        fetch: opts.fetch,
      });
    const result = await collector.optOut();
    if (!result.ok) {
      return { code: 1, message: `collection:opt-out rejected -- ${result.code}` };
    }
    clearCredentialsKeepConsent(projectRoot, revokedMirror, revokedSubmissions);
    dropLocalIdentity(projectRoot);
    return { code: 0, message: "collection: opted out" };
  } catch (err) {
    return {
      code: 2,
      message: `collection:opt-out error -- ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/** Re-export for callers that still want the metrics-only prompt state. */
export type { ConsentSignal };
export { localPromptState };
