import type { Collector } from "@deft/collection-sdk";
import { collector } from "./client.js";
import { readState, updateState, writeState } from "./storage.js";
import {
  CONSENT_VERSION,
  type CollectionFile,
  type CollectionPromptState,
  type ConsentSignal,
  type Contact,
  formatSignal,
  type IdentityState,
  type MetricsMode,
  type MetricsState,
  parseContact,
  type Result,
  type SdkContact,
  type SubmissionsState,
  scopesFor,
  signal,
} from "./types.js";

export type { ConsentSignal, Result };

type Change = {
  usage?: true;
  submissions?: true;
  /** Supplied contact ({} clears). Omitted keeps server contact. */
  contact?: SdkContact;
};

async function guard(label: string, fn: () => Promise<Result>): Promise<Result> {
  try {
    return await fn();
  } catch (err) {
    return {
      code: 2,
      message: `${label} error -- ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

type ApplyOk = Result & { scopes: string[] };

function rejectPrefix(label: string): string {
  if (label.startsWith("feedback")) {
    return "feedback: submissions opt-in";
  }
  if (label.startsWith("collection:identity")) {
    return "collection:identity";
  }
  return "collection:opt-in";
}

function persistChange(root: string, change: Change, expiresAt: number, decidedAt: string): void {
  updateState(root, (prior) => {
    let next: CollectionFile = { ...prior };
    if (change.usage === true) {
      next = {
        ...next,
        metrics: {
          decision: "active",
          consentVersion: CONSENT_VERSION,
          decidedAt,
          expiresAt,
        },
      };
    }
    if (change.submissions === true) {
      next = {
        ...next,
        submissions: {
          consentVersion: CONSENT_VERSION,
          decidedAt,
          expiresAt,
        },
      };
    }
    if (change.contact !== undefined) {
      next = { ...next, attributed: Object.keys(change.contact).length > 0 };
    }
    return next;
  });
}

function revokeUsageOnMissingScope(root: string, decidedAt: string): Result {
  updateState(root, (prior) => {
    if (prior.metrics?.decision !== "active") {
      return prior;
    }
    return {
      ...prior,
      metrics: {
        decision: "revoked",
        consentVersion: CONSENT_VERSION,
        decidedAt,
      },
    };
  });
  return {
    code: 1,
    message: "collection:opt-in rejected -- server did not grant usage scope",
  };
}

/** Single sync primitive: register once, one optIn, one state update (ARC-3). */
async function apply(root: string, change: Change, label: string): Promise<ApplyOk | Result> {
  return guard(label, async () => {
    const col = collector(root);
    const registered = await col.ensureRegistered();
    if (!registered.ok) {
      const prefix = label.startsWith("feedback") ? "feedback" : "collection:opt-in";
      return {
        code: registered.code === "not_registered" ? 1 : 2,
        message: `${prefix} register failed -- ${registered.code}`,
      };
    }
    const scopes = scopesFor(readState(root), Date.now(), {
      usage: change.usage,
      submissions: change.submissions,
    });
    const result = await col.optIn({
      scopes,
      consentVersion: CONSENT_VERSION,
      ...(change.contact !== undefined ? { contact: change.contact } : {}),
    });
    if (!result.ok) {
      return { code: 1, message: `${rejectPrefix(label)} rejected -- ${result.code}` };
    }
    const decidedAt = new Date().toISOString();
    if (change.usage === true && !result.scopes.includes("usage")) {
      return revokeUsageOnMissingScope(root, decidedAt);
    }
    persistChange(root, change, result.expiresAt, decidedAt);
    return {
      code: 0,
      message: "ok",
      scopes: result.scopes.filter((s) => s === "usage"),
    };
  });
}

export async function optIn(
  root: string,
  contact: SdkContact,
  opts: { confirm: boolean } = { confirm: true },
): Promise<Result & { scopes?: readonly string[]; metricsMode?: MetricsMode | null }> {
  if (opts.confirm !== true) {
    return { code: 1, message: "collection:opt-in requires --confirm" };
  }
  const applied = await apply(root, { usage: true, contact }, "collection:opt-in");
  if (applied.code !== 0) {
    return applied;
  }
  const mode = signal(readState(root)).metricsMode;
  const scopes = "scopes" in applied ? applied.scopes : ["usage"];
  return {
    code: 0,
    message: `collection: opted in scopes=[${scopes.join(",")}] metricsMode=${mode}`,
    scopes,
    metricsMode: mode,
  };
}

export async function grantSubmissions(
  root: string,
): Promise<Result & { scopes?: readonly string[] }> {
  const applied = await apply(root, { submissions: true }, "feedback: submissions grant");
  if (applied.code !== 0) {
    return applied;
  }
  return {
    code: 0,
    message: "feedback: submissions granted scopes=[feedback,bug,feature]",
    scopes: ["feedback", "bug", "feature"],
  };
}

function hasCredentials(file: CollectionFile): boolean {
  return (
    typeof file.installId === "string" &&
    file.installId.length > 0 &&
    typeof file.token === "string" &&
    file.token.length > 0
  );
}

function hasActiveTrack(file: CollectionFile, nowMs: number = Date.now()): boolean {
  const sig = signal(file, nowMs);
  return sig.metrics === "active" || sig.submissions === "granted";
}

export async function contactUpdate(
  root: string,
  fields: Contact,
): Promise<Result & { mode: IdentityState }> {
  const parsed = parseContact(fields);
  if (!parsed.ok) {
    return { code: 2, mode: "anonymous", message: parsed.message };
  }
  if (Object.keys(parsed.sdk).length === 0) {
    return {
      code: 2,
      mode: "anonymous",
      message: "collection:identity --update requires at least one non-empty field",
    };
  }
  const state = readState(root);
  if (!hasCredentials(state) || !hasActiveTrack(state)) {
    return {
      code: 1,
      mode: signal(state).identity,
      message: "collection:identity --update: opt in first",
    };
  }
  const applied = await apply(root, { contact: parsed.sdk }, "collection:identity");
  const mode = signal(readState(root)).identity;
  if (applied.code !== 0) {
    return { code: applied.code, mode, message: applied.message };
  }
  return { code: 0, mode, message: `collection:identity updated identity=${mode}` };
}

export async function contactClear(root: string): Promise<Result & { mode: IdentityState }> {
  const state = readState(root);
  if (hasCredentials(state) && hasActiveTrack(state)) {
    const applied = await apply(root, { contact: {} }, "collection:identity");
    if (applied.code !== 0) {
      return { code: applied.code, mode: "anonymous", message: applied.message };
    }
    return {
      code: 0,
      mode: "anonymous",
      message: "collection:identity cleared identity=anonymous",
    };
  }
  updateState(root, (prior) => ({ ...prior, attributed: false }));
  return {
    code: 0,
    mode: "anonymous",
    message: "collection:identity cleared identity=anonymous",
  };
}

export function decline(root: string): Result {
  try {
    updateState(root, (existing) => ({
      ...(existing.installId !== undefined ? { installId: existing.installId } : {}),
      ...(existing.token !== undefined ? { token: existing.token } : {}),
      metrics: {
        decision: "declined",
        consentVersion: CONSENT_VERSION,
        decidedAt: new Date().toISOString(),
      },
      ...(existing.submissions !== undefined ? { submissions: existing.submissions } : {}),
      ...(existing.attributed !== undefined ? { attributed: existing.attributed } : {}),
    }));
    return { code: 0, message: "collection: declined metricsMode=disallowed" };
  } catch (err) {
    return {
      code: 2,
      message: `collection:decline error -- ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export async function optOut(
  root: string,
  opts: { confirm?: boolean; identity?: boolean } = {},
): Promise<Result> {
  if (opts.identity === true && opts.confirm !== true) {
    const cleared = await contactClear(root);
    return {
      code: cleared.code,
      message:
        cleared.code === 0 ? "collection: identity cleared (opt-out --identity)" : cleared.message,
    };
  }
  if (opts.confirm !== true) {
    return { code: 1, message: "collection:opt-out requires --confirm" };
  }

  const file = readState(root);
  const revoked = {
    decision: "revoked" as const,
    consentVersion: file.metrics?.consentVersion ?? CONSENT_VERSION,
    decidedAt: new Date().toISOString(),
  };

  if (!hasCredentials(file)) {
    writeState(root, { metrics: revoked });
    return { code: 0, message: "collection: opted out (local only) metricsMode=disallowed" };
  }

  return guard("collection:opt-out", async () => {
    const result = await collector(root).optOut();
    if (!result.ok) {
      return { code: 1, message: `collection:opt-out rejected -- ${result.code}` };
    }
    writeState(root, { metrics: revoked });
    return { code: 0, message: "collection: opted out metricsMode=disallowed (install rotated)" };
  });
}

export interface CollectionStatus {
  readonly promptState: CollectionPromptState;
  readonly metrics: MetricsState;
  readonly metricsMode: MetricsMode;
  readonly submissions: SubmissionsState;
  readonly identity: IdentityState;
  readonly identityMode: IdentityState;
  readonly scopes: readonly string[];
  readonly consentVersion?: string;
  readonly expiresAt?: number;
  readonly installId?: string;
}

export function status(root: string): {
  readonly code: 0 | 1;
  readonly status: CollectionStatus;
  readonly message: string;
} {
  const file = readState(root);
  const sig = signal(file);
  const st: CollectionStatus = {
    promptState: sig.metrics,
    metrics: sig.metrics,
    metricsMode: sig.metricsMode,
    submissions: sig.submissions,
    identity: sig.identity,
    identityMode: sig.identityMode,
    scopes: scopesFor(file, Date.now()),
    consentVersion: file.metrics?.consentVersion ?? file.submissions?.consentVersion,
    expiresAt: file.metrics?.expiresAt ?? file.submissions?.expiresAt,
    installId: file.installId,
  };
  const code: 0 | 1 = sig.metrics === "active" || sig.submissions === "granted" ? 0 : 1;
  return { code, status: st, message: formatSignal(sig) };
}

export function hasUsageConsent(root: string, nowMs: number = Date.now()): boolean {
  return signal(readState(root), nowMs).metrics === "active";
}

export function usageCollector(root: string): Collector | undefined {
  if (!hasUsageConsent(root)) {
    return undefined;
  }
  return collector(root);
}

export function contactShow(root: string): {
  readonly code: 0;
  readonly mode: IdentityState;
  readonly message: string;
} {
  const mode = signal(readState(root)).identity;
  return { code: 0, mode, message: `identity=${mode}` };
}
