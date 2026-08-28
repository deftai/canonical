/** `canon feedback` -- submit bug | feature | feedback via collection SDK. */
import { readFileSync } from "node:fs";
import { parseArgs, renderJson } from "../args/index.js";
import { type FeedbackKind, submitFeedback } from "../collection/index.js";

const KINDS = new Set<FeedbackKind>(["bug", "feature", "feedback"]);

const FILE_FIELDS = [
  ["summary", "summary-file"],
  ["message", "message-file"],
  ["details", "details-file"],
  ["context", "context-file"],
  ["stack", "stack-file"],
  ["logs", "logs-file"],
] as const;

function printHelp(): void {
  process.stdout.write(`canon feedback — submit bug | feature | feedback

Usage:
  canon feedback --kind=bug|feature|feedback [flags]
  task -x feedback -- --kind=... [flags]

Required:
  --kind=bug|feature|feedback

Kind fields:
  bug       --summary (or --message); optional --stack --logs --os
  feature   --summary (or --message); optional --details --context
  feedback  --message (or --summary); optional --rating=1..5

File flags (preferred for multiline / free-text through task):
  --summary-file PATH   --message-file PATH   --details-file PATH
  --context-file PATH   --stack-file PATH     --logs-file PATH
  Write bodies to a temp file outside the worktree (scm.md --body-file pattern).
  Inline + file for the same field is a conflict (exit 2).

Other:
  --project-root PATH   --json   --dry-run (validate, do not submit)
  --disclosure-accepted  after user agrees to submissions disclosure
  --as-anonymous         do not sync/update contact for this submit (PRIV-2)
  --help

Multiline guidance:
  Do not pass unquoted multiline --details/--context/--stack/--logs through
  \`task -x feedback\` inline strings. Use the matching --*-file flag, or invoke
  \`canon feedback\` with a real argv list (no shell join).
`);
}

function readFieldFile(
  flag: string,
  path: string,
): { ok: true; value: string } | { ok: false; message: string } {
  try {
    return { ok: true, value: readFileSync(path, "utf8") };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { ok: false, message: `cannot read --${flag} ${path}: ${detail}` };
  }
}

export async function run(argv: string[]): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    printHelp();
    return 0;
  }

  const parsed = parseArgs(argv, {
    valueFlags: [
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
    ],
    boolFlags: ["json", "dry-run", "disclosure-accepted", "as-anonymous"],
    maxPositional: 0,
  });
  if (parsed.error !== undefined) {
    process.stderr.write(`canon: feedback: ${parsed.error}\n`);
    return 2;
  }

  const kindRaw = parsed.values.kind;
  if (kindRaw === undefined || !KINDS.has(kindRaw as FeedbackKind)) {
    process.stderr.write("canon: feedback: --kind=bug|feature|feedback is required\n");
    return 2;
  }
  const kind = kindRaw as FeedbackKind;

  const values: Record<string, string | undefined> = {
    summary: parsed.values.summary,
    message: parsed.values.message,
    details: parsed.values.details,
    context: parsed.values.context,
    stack: parsed.values.stack,
    logs: parsed.values.logs,
  };

  for (const [inlineName, fileName] of FILE_FIELDS) {
    const filePath = parsed.values[fileName];
    if (filePath === undefined) {
      continue;
    }
    if (values[inlineName] !== undefined) {
      process.stderr.write(
        `canon: feedback: conflict: --${inlineName} and --${fileName} both set\n`,
      );
      return 2;
    }
    const read = readFieldFile(fileName, filePath);
    if (!read.ok) {
      process.stderr.write(`canon: feedback: ${read.message}\n`);
      return 2;
    }
    values[inlineName] = read.value;
  }

  let rating: number | undefined;
  if (parsed.values.rating !== undefined) {
    rating = Number(parsed.values.rating);
    if (!Number.isFinite(rating)) {
      process.stderr.write("canon: feedback: --rating must be a number\n");
      return 2;
    }
  }

  const projectRoot = parsed.values["project-root"] ?? ".";
  const dryRun = parsed.flags["dry-run"] === true;
  const disclosureAccepted = parsed.flags["disclosure-accepted"] === true;
  const asAnonymous = parsed.flags["as-anonymous"] === true;
  const result = await submitFeedback(projectRoot, {
    kind,
    summary: values.summary,
    message: values.message,
    details: values.details,
    context: values.context,
    rating,
    stack: values.stack,
    logs: values.logs,
    os: parsed.values.os,
    dryRun,
    disclosureAccepted,
    asAnonymous,
  });

  if (parsed.flags.json === true) {
    process.stdout.write(
      `${renderJson({
        code: result.code,
        disclosure_required: result.disclosureRequired === true,
        dry_run: result.dryRun === true,
        id: result.id ?? null,
        message: result.message,
        payload: result.payload ?? null,
        scope: result.scope ?? null,
      })}\n`,
    );
  } else if (result.code === 0) {
    process.stdout.write(`${result.message}\n`);
  } else {
    process.stderr.write(`${result.message}\n`);
  }
  return result.code;
}
