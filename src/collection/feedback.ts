import { platform as osPlatform, release as osRelease } from "node:os";
import { collector } from "./client.js";
import { grantSubmissions } from "./consent.js";
import { readState } from "./storage.js";
import { signal } from "./types.js";

function granted(file: ReturnType<typeof readState>): boolean {
  return signal(file).submissions === "granted";
}
function scopeOk(file: ReturnType<typeof readState>, scope: string): boolean {
  return granted(file) && (["feedback", "bug", "feature"] as readonly string[]).includes(scope);
}
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
function disclosurePending(
  scope: FeedbackKind,
  payload: Record<string, unknown>,
  version: string,
): SubmitFeedbackResult {
  return {
    code: 1,
    message:
      `feedback: user confirm required -- will send: canonical version (${version}), ` +
      `installId, and ${scope} fields. After the user confirms the filing ` +
      `in plain English, re-run with --disclosure-accepted (agent-internal; does not ` +
      `enable metrics). Load feedback.md for the dialogue.`,
    disclosureRequired: true,
    scope,
    payload,
  };
}
async function submitBuilt(
  projectRoot: string,
  scope: FeedbackKind,
  payload: Record<string, unknown>,
  asAnonymous: boolean,
): Promise<SubmitFeedbackResult> {
  let file = readState(projectRoot);
  if (!granted(file)) {
    const grant = await grantSubmissions(projectRoot);
    if (grant.code !== 0) return { code: grant.code, message: grant.message };
    file = readState(projectRoot);
  }
  if (!scopeOk(file, scope)) {
    return {
      code: 1,
      message: `feedback: not opted in for scope '${scope}' (load feedback.md; pass --disclosure-accepted after user confirm)`,
    };
  }
  try {
    const result = await collector(projectRoot).submit(scope, payload);
    if (!result.ok) return { code: 1, message: `feedback: submit rejected -- ${result.code}` };
    return {
      code: 0,
      message: `feedback: submitted ${scope} id=${result.id}${asAnonymous ? " (as-anonymous)" : ""}`,
      id: result.id,
      scope,
      payload,
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
  if (!built.ok) return { code: 2, message: built.message };
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
    return disclosurePending(built.scope, built.payload, opts.version ?? "unknown");
  }
  return submitBuilt(projectRoot, built.scope, built.payload, opts.asAnonymous === true);
}
