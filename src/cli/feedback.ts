import {
  FEEDBACK_BOOL_FLAGS,
  FEEDBACK_HELP,
  FEEDBACK_VALUE_FLAGS,
  feedbackJsonPayload,
  mergeFeedbackFileFields,
  out,
  parseArgs,
  parseFeedbackRating,
} from "../args/index.js";
import { type FeedbackKind, submitFeedback } from "../collection/index.js";

const KINDS = new Set<FeedbackKind>(["bug", "feature", "feedback"]);
export async function run(argv: string[]): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(FEEDBACK_HELP);
    return 0;
  }
  const parsed = parseArgs(argv, {
    valueFlags: [...FEEDBACK_VALUE_FLAGS],
    boolFlags: [...FEEDBACK_BOOL_FLAGS],
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
  const merged = mergeFeedbackFileFields(
    {
      summary: parsed.values.summary,
      message: parsed.values.message,
      details: parsed.values.details,
      context: parsed.values.context,
      stack: parsed.values.stack,
      logs: parsed.values.logs,
    },
    parsed.values,
  );
  if (!merged.ok) {
    process.stderr.write(`${merged.message}\n`);
    return 2;
  }
  const ratingParsed = parseFeedbackRating(parsed.values.rating);
  if (!ratingParsed.ok) {
    process.stderr.write(`${ratingParsed.message}\n`);
    return 2;
  }
  const result = await submitFeedback(parsed.values["project-root"] ?? ".", {
    kind: kindRaw as FeedbackKind,
    summary: merged.values.summary,
    message: merged.values.message,
    details: merged.values.details,
    context: merged.values.context,
    rating: ratingParsed.rating,
    stack: merged.values.stack,
    logs: merged.values.logs,
    os: parsed.values.os,
    dryRun: parsed.flags["dry-run"] === true,
    disclosureAccepted: parsed.flags["disclosure-accepted"] === true,
    asAnonymous: parsed.flags["as-anonymous"] === true,
  });
  return out(parsed.flags.json === true, result.code, feedbackJsonPayload(result), result.message);
}
