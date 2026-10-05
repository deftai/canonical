import type { Collector } from "@deft/collection-sdk";
import { collector } from "./client.js";
import { readState, updateState, writeState } from "./storage.js";
import {
  CONSENT_VERSION,
  type CollectionFile,
  type ConsentSignal,
  type Contact,
  formatSignal,
  type IdentityState,
  type MetricsMode,
  parseContact,
  type Result,
  type SdkContact,
  scopesFor,
  signal,
} from "./types.js";

export type { ConsentSignal, Result };

type Change = { usage?: true; submissions?: true; contact?: SdkContact };
type ApplyOk = Result & { scopes: string[] };
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
function rejectPrefix(label: string): string {
  if (label.startsWith("feedback")) {
    return "feedback: submissions opt-in";
  }
  return label.startsWith("collection:identity") ? "collection:identity" : "collection:opt-in";
}
function persistChange(root: string, change: Change, expiresAt: number, decidedAt: string): void {
  updateState(root, (prior) => {
    let next: CollectionFile = { ...prior };
    if (change.usage === true) {
      next = {
        ...next,
        metrics: { decision: "active", consentVersion: CONSENT_VERSION, decidedAt, expiresAt },
      };
    }
    if (change.submissions === true) {
      next = {
        ...next,
        submissions: { consentVersion: CONSENT_VERSION, decidedAt, expiresAt },
      };
    }
    if (change.contact !== undefined) {
      next = { ...next, attributed: Object.keys(change.contact).length > 0 };
    }
    return next;
  });
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
    const result = await col.optIn({
      scopes: scopesFor(readState(root), Date.now(), {
        usage: change.usage,
        submissions: change.submissions,
      }),
      consentVersion: CONSENT_VERSION,
      ...(change.contact !== undefined ? { contact: change.contact } : {}),
    });
    if (!result.ok) {
      return { code: 1, message: `${rejectPrefix(label)} rejected -- ${result.code}` };
    }
    const decidedAt = new Date().toISOString();
    if (change.usage === true && !result.scopes.includes("usage")) {
      updateState(root, (prior) =>
        prior.metrics?.decision !== "active"
          ? prior
          : {
              ...prior,
              metrics: { decision: "revoked", consentVersion: CONSENT_VERSION, decidedAt },
            },
      );
      return {
        code: 1,
        message: "collection:opt-in rejected -- server did not grant usage scope",
      };
    }
    persistChange(root, change, result.expiresAt, decidedAt);
    return { code: 0, message: "ok", scopes: result.scopes.filter((s) => s === "usage") };
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
function ready(file: CollectionFile): boolean {
  const creds =
    typeof file.installId === "string" &&
    file.installId.length > 0 &&
    typeof file.token === "string" &&
    file.token.length > 0;
  if (!creds) {
    return false;
  }
  const sig = signal(file);
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
  if (!ready(state)) {
    return {
      code: 1,
      mode: signal(state).identity,
      message: "collection:identity --update: opt in first",
    };
  }
  const applied = await apply(root, { contact: parsed.sdk }, "collection:identity");
  const mode = signal(readState(root)).identity;
  return applied.code !== 0
    ? { code: applied.code, mode, message: applied.message }
    : { code: 0, mode, message: `collection:identity updated identity=${mode}` };
}
export async function contactClear(root: string): Promise<Result & { mode: IdentityState }> {
  if (ready(readState(root))) {
    const applied = await apply(root, { contact: {} }, "collection:identity");
    if (applied.code !== 0) {
      return { code: applied.code, mode: "anonymous", message: applied.message };
    }
  } else {
    updateState(root, (prior) => ({ ...prior, attributed: false }));
  }
  return { code: 0, mode: "anonymous", message: "collection:identity cleared identity=anonymous" };
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
  const creds =
    typeof file.installId === "string" &&
    file.installId.length > 0 &&
    typeof file.token === "string" &&
    file.token.length > 0;
  if (!creds) {
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
export function status(root: string): {
  readonly code: 0 | 1;
  readonly message: string;
  readonly json: Record<string, unknown>;
} {
  const file = readState(root);
  const sig = signal(file);
  const message = formatSignal(sig);
  const code: 0 | 1 = sig.metrics === "active" || sig.submissions === "granted" ? 0 : 1;
  return {
    code,
    message,
    json: {
      code,
      consent_version: file.metrics?.consentVersion ?? file.submissions?.consentVersion ?? null,
      expires_at: file.metrics?.expiresAt ?? file.submissions?.expiresAt ?? null,
      identity: sig.identity,
      identity_mode: sig.identityMode,
      install_id: file.installId ?? null,
      message,
      metrics: sig.metrics,
      metrics_mode: sig.metricsMode,
      prompt_state: sig.metrics,
      scopes: scopesFor(file, Date.now()),
      submissions: sig.submissions,
    },
  };
}
export function hasUsageConsent(root: string, nowMs: number = Date.now()): boolean {
  return signal(readState(root), nowMs).metrics === "active";
}
export function usageCollector(root: string): Collector | undefined {
  return hasUsageConsent(root) ? collector(root) : undefined;
}
export function contactShow(root: string): {
  readonly code: 0;
  readonly mode: IdentityState;
  readonly message: string;
} {
  const mode = signal(readState(root)).identity;
  return { code: 0, mode, message: `identity=${mode}` };
}
