import { readFileSync } from "node:fs";
import {
  buildSessionSummaryDimensions,
  bump,
  clearSession,
  emitUsage,
} from "../collection/index.js";

export const COLLECTION_IDENTITY_HELP =
  "canon collection:identity — manage reply-channel identity\n\n" +
  "Usage:\n  canon collection:identity --show\n" +
  "  canon collection:identity --clear\n" +
  "  canon collection:identity --update [--first-name=…] [--last-name=…] [--email=…] [--mobile=…]\n" +
  "  task -x collection:identity -- --show|--clear|--update …\n\n" +
  "Notes:\n  --show prints identity=<identified|anonymous> only.\n" +
  "  Contact is stored on the server; the client keeps an attributed flag.\n";

export const FEEDBACK_VALUE_FLAGS = [
  "project-root",
  "kind",
  "summary",
  "message",
  "details",
  "context",
  "rating",
  "stack",
  "logs",
  "os",
  "summary-file",
  "message-file",
  "details-file",
  "context-file",
  "stack-file",
  "logs-file",
] as const;

export const FEEDBACK_BOOL_FLAGS = [
  "json",
  "dry-run",
  "disclosure-accepted",
  "as-anonymous",
] as const;

export const FEEDBACK_FILE_FIELDS = [
  ["summary", "summary-file"],
  ["message", "message-file"],
  ["details", "details-file"],
  ["context", "context-file"],
  ["stack", "stack-file"],
  ["logs", "logs-file"],
] as const;

export const FEEDBACK_HELP =
  "canon feedback — submit bug | feature | feedback\n\n" +
  "Usage:\n  canon feedback --kind=bug|feature|feedback [flags]\n" +
  "  task -x feedback -- --kind=... [flags]\n\n" +
  "Kind fields:\n" +
  "  bug       --summary (or --message); optional --stack --logs --os\n" +
  "  feature   --summary (or --message); optional --details --context\n" +
  "  feedback  --message (or --summary); optional --rating=1..5\n\n" +
  "File flags (preferred for multiline): --summary-file --message-file --details-file\n" +
  "  --context-file --stack-file --logs-file (inline + file for same field exits 2)\n\n" +
  "Other: --project-root --json --dry-run --disclosure-accepted --as-anonymous --help\n";

export type FeedbackFieldBag = {
  summary?: string;
  message?: string;
  details?: string;
  context?: string;
  stack?: string;
  logs?: string;
};

/** Merge inline feedback fields with --*-file contents; conflict or read error → ok:false. */
export function mergeFeedbackFileFields(
  inline: FeedbackFieldBag,
  filePaths: Readonly<Record<string, string | undefined>>,
): { ok: true; values: FeedbackFieldBag } | { ok: false; message: string } {
  const values: FeedbackFieldBag = { ...inline };
  for (const [inlineName, fileName] of FEEDBACK_FILE_FIELDS) {
    const filePath = filePaths[fileName];
    if (filePath === undefined) {
      continue;
    }
    const key = inlineName as keyof FeedbackFieldBag;
    if (values[key] !== undefined) {
      return {
        ok: false,
        message: `canon: feedback: conflict: --${inlineName} and --${fileName} both set`,
      };
    }
    try {
      values[key] = readFileSync(filePath, "utf8");
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        message: `canon: feedback: cannot read --${fileName} ${filePath}: ${detail}`,
      };
    }
  }
  return { ok: true, values };
}

export function parseFeedbackRating(
  raw: string | undefined,
): { ok: true; rating?: number } | { ok: false; message: string } {
  if (raw === undefined) {
    return { ok: true };
  }
  const rating = Number(raw);
  if (!Number.isFinite(rating)) {
    return { ok: false, message: "canon: feedback: --rating must be a number" };
  }
  return { ok: true, rating };
}

export function feedbackJsonPayload(result: {
  readonly code: number;
  readonly disclosureRequired?: boolean;
  readonly dryRun?: boolean;
  readonly id?: string;
  readonly message: string;
  readonly payload?: Record<string, unknown>;
  readonly scope?: string | null;
}): Record<string, unknown> {
  return {
    code: result.code,
    disclosure_required: result.disclosureRequired === true,
    dry_run: result.dryRun === true,
    id: result.id ?? null,
    message: result.message,
    payload: result.payload ?? null,
    scope: result.scope ?? null,
  };
}

/**
 * `--json` output convention: one line, keys sorted, snake_case keys,
 * written to stdout by the caller. Diagnostics stay on stderr.
 */
export function renderJson(payload: Record<string, unknown>): string {
  const sorted = Object.fromEntries(
    Object.keys(payload)
      .sort()
      .map((k) => [k, payload[k]]),
  );
  return JSON.stringify(sorted);
}

/** Write JSON to stdout, or text to stdout (code 0) / stderr (nonzero). */
export function out(
  json: boolean,
  code: number,
  payload: Record<string, unknown>,
  text: string,
  alwaysStdout = false,
): number {
  if (json) {
    process.stdout.write(`${renderJson(payload)}\n`);
    return code;
  }
  if ((alwaysStdout || code === 0) && text.length > 0) {
    process.stdout.write(`${text}\n`);
  } else if (!alwaysStdout && code !== 0) {
    process.stderr.write(`${text}\n`);
  }
  return code;
}

export function resultOut(json: boolean, result: { code: number; message: string }): number {
  return out(json, result.code, { code: result.code, message: result.message }, result.message);
}

/** Map collection CLI contact value flags to Contact fields. */
export function contactFlagFields(values: {
  readonly ["first-name"]?: string;
  readonly ["last-name"]?: string;
  readonly email?: string;
  readonly mobile?: string;
}): {
  firstName?: string;
  lastName?: string;
  email?: string;
  mobile?: string;
} {
  const out: {
    firstName?: string;
    lastName?: string;
    email?: string;
    mobile?: string;
  } = {};
  if (values["first-name"] !== undefined) out.firstName = values["first-name"];
  if (values["last-name"] !== undefined) out.lastName = values["last-name"];
  if (values.email !== undefined) out.email = values.email;
  if (values.mobile !== undefined) out.mobile = values.mobile;
  return out;
}

/** Validate collection metric --metric/--value; returns trimmed name + numeric value. */
export function parseMetricArgs(
  metric: string | undefined,
  valueRaw: string | undefined,
): { ok: true; name: string; value: number } | { ok: false; message: string } {
  if (metric === undefined || metric.trim().length === 0) {
    return { ok: false, message: "canon: collection-metric: --metric is required" };
  }
  if (valueRaw === undefined) {
    return { ok: false, message: "canon: collection-metric: --value is required" };
  }
  const value = Number(valueRaw);
  if (!Number.isFinite(value)) {
    return { ok: false, message: "canon: collection-metric: --value must be a number" };
  }
  return { ok: true, name: metric.trim(), value };
}

export function recordAgentTurn(root: string, json: boolean): number {
  bump(root, "agentTurns");
  if (json) process.stdout.write(`${renderJson({ code: 0, recorded: true })}\n`);
  return 0;
}

export async function emitMetricNamed(
  root: string,
  name: string,
  value: number,
  opts: {
    period?: string;
    debug: boolean;
    json: boolean;
    dimensions?: Readonly<Record<string, string | number | boolean>>;
  },
): Promise<number> {
  let dimensions = opts.dimensions;
  if (name === "session_summary" && dimensions === undefined) {
    dimensions = buildSessionSummaryDimensions(root);
  }
  const outcome = await emitUsage(root, name, value, {
    period: opts.period,
    debug: opts.debug,
    ...(dimensions !== undefined ? { dimensions } : {}),
  });
  if (name === "session_summary" && outcome.emitted) clearSession(root);
  const text = outcome.emitted
    ? `collection:metric emitted id=${outcome.id}`
    : `collection:metric skipped (${outcome.reason})`;
  return out(opts.json, 0, { code: 0, ...outcome }, text, true);
}

/** Parse `--dimensions` JSON object of string|number|boolean within maxBytes. */
export function parseDimensionsJson(
  raw: string | undefined,
  maxBytes: number,
):
  | { ok: true; dimensions?: Readonly<Record<string, string | number | boolean>> }
  | { ok: false; message: string } {
  if (raw === undefined) {
    return { ok: true };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, message: "--dimensions must be valid JSON" };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, message: "--dimensions must be a JSON object" };
  }
  const dimensions: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
      return {
        ok: false,
        message: `--dimensions values must be string|number|boolean (bad key '${key}')`,
      };
    }
    dimensions[key] = value;
  }
  if (Buffer.byteLength(JSON.stringify(dimensions), "utf8") > maxBytes) {
    return { ok: false, message: "--dimensions payload exceeds 2KiB" };
  }
  return { ok: true, dimensions };
}
