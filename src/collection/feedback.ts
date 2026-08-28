import { platform as osPlatform, release as osRelease } from "node:os";
import type { Collector } from "@deft/collection-sdk";
import { type CreateCanonicalCollectorOptions, createCanonicalCollector } from "./client.js";
import { grantSubmissions } from "./consent.js";
import { hasScopeConsent, hasSubmissionsGrant, readCollectionFile } from "./storage.js";
import { CONSENT_VERSION } from "./types.js";

export type FeedbackKind = "bug" | "feature" | "feedback";

export interface SubmitFeedbackOptions extends CreateCanonicalCollectorOptions {
  readonly kind: FeedbackKind;
  /** feedback.message or bug/feature.summary */
  readonly message?: string;
  readonly summary?: string;
  readonly details?: string;
  readonly context?: string;
  readonly rating?: number;
  readonly stack?: string;
  readonly logs?: string;
  readonly os?: string;
  readonly collector?: Collector;
  /** Validate + consent-check without calling the collector. */
  readonly dryRun?: boolean;
  /**
   * User accepted the submissions disclosure. Triggers register + submission-scope
   * opt-in when submissions are not yet granted. Never flips metrics consent.
   */
  readonly disclosureAccepted?: boolean;
  /**
   * Force anonymous for this submit: do not sync/update server contact.
   * Event payloads never carry identity either way (PRIV-2).
   */
  readonly asAnonymous?: boolean;
}

export interface SubmitFeedbackResult {
  readonly code: 0 | 1 | 2;
  readonly message: string;
  readonly id?: string;
  readonly dryRun?: boolean;
  readonly scope?: FeedbackKind;
  readonly payload?: Record<string, unknown>;
  readonly disclosureRequired?: boolean;
}

function buildPayload(
  opts: SubmitFeedbackOptions,
):
  | { ok: true; scope: FeedbackKind; payload: Record<string, unknown> }
  | { ok: false; message: string } {
  if (opts.kind === "feedback") {
    const message = opts.message ?? opts.summary;
    if (message === undefined || message.trim().length === 0) {
      return {
        ok: false,
        message: "feedback: --message (or --summary) is required for kind=feedback",
      };
    }
    const payload: Record<string, unknown> = { message: message.trim().slice(0, 5000) };
    if (opts.rating !== undefined) {
      if (!Number.isInteger(opts.rating) || opts.rating < 1 || opts.rating > 5) {
        return { ok: false, message: "feedback: --rating must be an integer 1..5" };
      }
      payload.rating = opts.rating;
    }
    return { ok: true, scope: "feedback", payload };
  }

  if (opts.kind === "bug") {
    const summary = opts.summary ?? opts.message;
    if (summary === undefined || summary.trim().length === 0) {
      return { ok: false, message: "feedback: --summary is required for kind=bug" };
    }
    const payload: Record<string, unknown> = {
      summary: summary.trim().slice(0, 300),
      os: (opts.os ?? `${osPlatform()} ${osRelease()}`).slice(0, 100),
    };
    if (opts.stack !== undefined) {
      payload.stack = opts.stack.slice(0, 20000);
    }
    if (opts.logs !== undefined) {
      payload.logs = opts.logs.slice(0, 99_000);
    }
    return { ok: true, scope: "bug", payload };
  }

  // feature
  const summary = opts.summary ?? opts.message;
  if (summary === undefined || summary.trim().length === 0) {
    return { ok: false, message: "feedback: --summary is required for kind=feature" };
  }
  const payload: Record<string, unknown> = { summary: summary.trim().slice(0, 300) };
  if (opts.details !== undefined) {
    payload.details = opts.details.slice(0, 20_000);
  }
  if (opts.context !== undefined) {
    payload.context = opts.context.slice(0, 200);
  }
  return { ok: true, scope: "feature", payload };
}

function disclosureMessage(kind: FeedbackKind, version: string): string {
  return (
    `feedback: disclosure required -- will send: canonical version (${version}), ` +
    `installId, correlator, and ${kind} fields. Re-run with --disclosure-accepted ` +
    `after the user agrees (does not enable metrics). Load feedback.md for the full flow.`
  );
}

export async function submitFeedback(
  projectRoot: string,
  opts: SubmitFeedbackOptions,
): Promise<SubmitFeedbackResult> {
  const built = buildPayload(opts);
  if (!built.ok) {
    return { code: 2, message: built.message };
  }

  // Validate payload shape without consent or network so agents can debug
  // flags/multiline transport without live collector probes (#8).
  if (opts.dryRun === true) {
    return {
      code: 0,
      message: `feedback: dry-run ok ${built.scope} (not submitted)`,
      dryRun: true,
      scope: built.scope,
      payload: built.payload,
    };
  }

  let file = readCollectionFile(projectRoot);
  if (!hasSubmissionsGrant(file)) {
    if (opts.disclosureAccepted !== true) {
      const version = opts.version ?? "unknown";
      return {
        code: 1,
        message: disclosureMessage(built.scope, version),
        disclosureRequired: true,
        scope: built.scope,
        payload: built.payload,
      };
    }

    const granted = await grantSubmissions(projectRoot, {
      configDir: opts.configDir,
      baseUrl: opts.baseUrl,
      environment: opts.environment,
      version: opts.version,
      fetch: opts.fetch,
      collector: opts.collector,
      consentVersion: CONSENT_VERSION,
    });
    if (granted.code !== 0) {
      return { code: granted.code, message: granted.message };
    }
    file = readCollectionFile(projectRoot);
  }

  if (!hasScopeConsent(file, built.scope)) {
    return {
      code: 1,
      message: `feedback: not opted in for scope '${built.scope}' (load feedback.md for disclosure)`,
    };
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
    // PRIV-2: submit event payloads only — never attach contact/identity.
    // --as-anonymous skips any contact sync for this call (identity file unchanged).
    const result = await collector.submit(built.scope, built.payload);
    if (!result.ok) {
      return { code: 1, message: `feedback: submit rejected -- ${result.code}` };
    }
    const anonNote = opts.asAnonymous === true ? " (as-anonymous)" : "";
    return {
      code: 0,
      message: `feedback: submitted ${built.scope} id=${result.id}${anonNote}`,
      id: result.id,
      scope: built.scope,
      payload: built.payload,
    };
  } catch (err) {
    return {
      code: 2,
      message: `feedback: error -- ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
