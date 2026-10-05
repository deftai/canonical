import { platform as osPlatform, release as osRelease } from "node:os";
import type { Collector } from "@deft/collection-sdk";
import { collector } from "./client.js";
import { grantSubmissions } from "./consent.js";
import { hasScopeConsent, hasSubmissionsGrant, readState } from "./storage.js";

export type FeedbackKind = "bug" | "feature" | "feedback";

export interface SubmitFeedbackOptions {
  readonly kind: FeedbackKind;
  readonly message?: string;
  readonly summary?: string;
  readonly details?: string;
  readonly context?: string;
  readonly rating?: number;
  readonly stack?: string;
  readonly logs?: string;
  readonly os?: string;
  readonly collector?: Collector;
  readonly dryRun?: boolean;
  readonly disclosureAccepted?: boolean;
  readonly asAnonymous?: boolean;
  readonly version?: string;
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

type KindSpec = {
  required: "message" | "summary";
  fallback: "summary" | "message";
  maxRequired: number;
  defaults?: () => Record<string, string>;
  optional: ReadonlyArray<{ key: string; from: keyof SubmitFeedbackOptions; max: number }>;
};

const KIND_TABLE: Record<FeedbackKind, KindSpec> = {
  feedback: {
    required: "message",
    fallback: "summary",
    maxRequired: 5000,
    optional: [{ key: "rating", from: "rating", max: 0 }],
  },
  bug: {
    required: "summary",
    fallback: "message",
    maxRequired: 300,
    defaults: () => ({ os: `${osPlatform()} ${osRelease()}`.slice(0, 100) }),
    optional: [
      { key: "stack", from: "stack", max: 20_000 },
      { key: "logs", from: "logs", max: 99_000 },
    ],
  },
  feature: {
    required: "summary",
    fallback: "message",
    maxRequired: 300,
    optional: [
      { key: "details", from: "details", max: 20_000 },
      { key: "context", from: "context", max: 200 },
    ],
  },
};

function buildPayload(
  opts: SubmitFeedbackOptions,
):
  | { ok: true; scope: FeedbackKind; payload: Record<string, unknown> }
  | { ok: false; message: string } {
  const spec = KIND_TABLE[opts.kind];
  const primary = opts[spec.required] ?? opts[spec.fallback];
  if (typeof primary !== "string" || primary.trim().length === 0) {
    const flag = spec.required === "message" ? "--message (or --summary)" : "--summary";
    return { ok: false, message: `feedback: ${flag} is required for kind=${opts.kind}` };
  }
  const payload: Record<string, unknown> = {
    [spec.required]: primary.trim().slice(0, spec.maxRequired),
    ...(spec.defaults?.() ?? {}),
  };
  if (opts.kind === "bug" && opts.os !== undefined) {
    payload.os = opts.os.slice(0, 100);
  }
  if (opts.kind === "feedback" && opts.rating !== undefined) {
    if (!Number.isInteger(opts.rating) || opts.rating < 1 || opts.rating > 5) {
      return { ok: false, message: "feedback: --rating must be an integer 1..5" };
    }
    payload.rating = opts.rating;
  }
  for (const field of spec.optional) {
    if (field.key === "rating") {
      continue;
    }
    const value = opts[field.from];
    if (typeof value === "string") {
      payload[field.key] = value.slice(0, field.max);
    }
  }
  return { ok: true, scope: opts.kind, payload };
}

function confirmRequiredMessage(kind: FeedbackKind, version: string): string {
  return (
    `feedback: user confirm required -- will send: canonical version (${version}), ` +
    `installId, and ${kind} fields. After the user confirms the filing ` +
    `in plain English, re-run with --disclosure-accepted (agent-internal; does not ` +
    `enable metrics). Load feedback.md for the dialogue.`
  );
}

async function sendFeedback(
  projectRoot: string,
  opts: SubmitFeedbackOptions,
  built: { scope: FeedbackKind; payload: Record<string, unknown> },
): Promise<SubmitFeedbackResult> {
  let file = readState(projectRoot);
  if (!hasSubmissionsGrant(file)) {
    const granted = await grantSubmissions(projectRoot);
    if (granted.code !== 0) {
      return { code: granted.code, message: granted.message };
    }
    file = readState(projectRoot);
  }
  if (!hasScopeConsent(file, built.scope)) {
    return {
      code: 1,
      message: `feedback: not opted in for scope '${built.scope}' (load feedback.md; pass --disclosure-accepted after user confirm)`,
    };
  }
  try {
    const col = opts.collector ?? collector(projectRoot);
    const result = await col.submit(built.scope, built.payload);
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

export async function submitFeedback(
  projectRoot: string,
  opts: SubmitFeedbackOptions,
): Promise<SubmitFeedbackResult> {
  const built = buildPayload(opts);
  if (!built.ok) {
    return { code: 2, message: built.message };
  }
  if (opts.dryRun === true) {
    return {
      code: 0,
      message: `feedback: dry-run ok ${built.scope} (not submitted)`,
      dryRun: true,
      scope: built.scope,
      payload: built.payload,
    };
  }
  if (opts.disclosureAccepted !== true) {
    return {
      code: 1,
      message: confirmRequiredMessage(built.scope, opts.version ?? "unknown"),
      disclosureRequired: true,
      scope: built.scope,
      payload: built.payload,
    };
  }
  return sendFeedback(projectRoot, opts, built);
}
