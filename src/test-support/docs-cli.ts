/**
 * Docs-vs-CLI helpers for FLOW-5: extract collection/feedback verbs and flags
 * from content/*.md and compare against the post-refactor CLI argument tables.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const VERB_RE = /\b(collection:(?:status|opt-in|decline|opt-out|identity|metric)|feedback)\b/g;
const FLAG_RE = /--([a-z][a-z0-9-]*)/g;
// End anchor: next ### heading or true EOF (JS has no \Z; $ with /m matches EOL).
const SECTION_RE =
  /^### `(collection:(?:status|opt-in|decline|opt-out|identity|metric)|feedback)`\s*\n([\s\S]*?)(?=^### |$(?![\s\S]))/gm;
const INVOCATION_RE =
  /`((?:task\s+-x\s+|canon\s+)?(?:collection:(?:status|opt-in|decline|opt-out|identity|metric)|feedback)\b[^`]*)`/g;

/** Accepted flags per verb — mirrors src/cli/collection.ts ACTIONS + feedback.ts. */
export const CLI_FLAG_TABLE: Readonly<Record<string, ReadonlySet<string>>> = {
  "collection:status": new Set(["project-root", "json", "help"]),
  "collection:opt-in": new Set([
    "project-root",
    "email",
    "first-name",
    "last-name",
    "mobile",
    "json",
    "confirm",
    "help",
  ]),
  "collection:decline": new Set(["project-root", "json", "help"]),
  "collection:opt-out": new Set(["project-root", "json", "confirm", "identity", "help"]),
  "collection:identity": new Set([
    "project-root",
    "first-name",
    "last-name",
    "email",
    "mobile",
    "json",
    "show",
    "clear",
    "update",
    "help",
  ]),
  "collection:metric": new Set([
    "project-root",
    "metric",
    "value",
    "period",
    "dimensions",
    "json",
    "debug",
    "help",
  ]),
  feedback: new Set([
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
    "json",
    "dry-run",
    "disclosure-accepted",
    "as-anonymous",
    "help",
  ]),
};

export type DocsCliPair = { readonly verb: string; readonly flag: string; readonly file: string };

function maskForeignBackticks(body: string, verb: string): string {
  return body.replace(/`([^`]*)`/g, (full, inner: string) => {
    VERB_RE.lastIndex = 0;
    const vm = VERB_RE.exec(inner);
    if (vm !== null && vm[1] !== verb) {
      return " ".repeat(full.length);
    }
    return full;
  });
}

function lineRelevant(line: string, verb: string): boolean {
  if (line.includes("**Does:**")) return true;
  if (line.includes("task -x") || line.includes("canon ")) return true;
  return line.includes(verb) && line.includes("--");
}

function extractFromText(
  text: string,
  file: string,
): {
  verbs: Set<string>;
  pairs: DocsCliPair[];
} {
  const verbs = new Set<string>();
  const pairKeys = new Set<string>();
  const pairs: DocsCliPair[] = [];

  const addPair = (verb: string, flag: string) => {
    const key = `${verb}\0${flag}`;
    if (pairKeys.has(key)) return;
    pairKeys.add(key);
    pairs.push({ verb, flag, file });
  };

  const sectionSpans: Array<{ start: number; end: number }> = [];
  SECTION_RE.lastIndex = 0;
  for (const m of text.matchAll(SECTION_RE)) {
    const verb = m[1];
    const body = m[2];
    if (verb === undefined || body === undefined || m.index === undefined) continue;
    verbs.add(verb);
    sectionSpans.push({ start: m.index, end: m.index + m[0].length });
    const cleaned = maskForeignBackticks(body, verb);
    for (const line of cleaned.split("\n")) {
      FLAG_RE.lastIndex = 0;
      if (!lineRelevant(line, verb)) continue;
      FLAG_RE.lastIndex = 0;
      for (const fm of line.matchAll(FLAG_RE)) {
        if (fm[1] !== undefined) addPair(verb, fm[1]);
      }
    }
  }

  const inSection = (pos: number) => sectionSpans.some((s) => pos >= s.start && pos < s.end);

  INVOCATION_RE.lastIndex = 0;
  for (const m of text.matchAll(INVOCATION_RE)) {
    const body = m[1];
    if (body === undefined) continue;
    VERB_RE.lastIndex = 0;
    const vm = VERB_RE.exec(body);
    if (vm === null || vm[1] === undefined) continue;
    const verb = vm[1];
    verbs.add(verb);
    const after = body.slice(vm.index + vm[0].length);
    FLAG_RE.lastIndex = 0;
    for (const fm of after.matchAll(FLAG_RE)) {
      if (fm[1] !== undefined) addPair(verb, fm[1]);
    }
  }

  let pos = 0;
  for (const line of text.split(/(?<=\n)/)) {
    const start = pos;
    pos += line.length;
    if (inSection(start)) continue;
    VERB_RE.lastIndex = 0;
    const found = [...line.matchAll(VERB_RE)]
      .map((m) => m[1])
      .filter((v): v is string => v !== undefined);
    const unique = [...new Set(found)];
    for (const v of unique) verbs.add(v);
    if (unique.length !== 1) continue;
    const verb = unique[0];
    if (verb === undefined) continue;
    FLAG_RE.lastIndex = 0;
    for (const fm of line.matchAll(FLAG_RE)) {
      if (fm[1] !== undefined) addPair(verb, fm[1]);
    }
  }

  return { verbs, pairs };
}

/** Scan content/*.md for collection/feedback verbs and adjacent --flags. */
export function extractDocsCliUsage(contentDir = join(process.cwd(), "content")): {
  verbs: string[];
  pairs: DocsCliPair[];
} {
  const verbs = new Set<string>();
  const pairs: DocsCliPair[] = [];
  const files = readdirSync(contentDir)
    .filter((n) => n.endsWith(".md"))
    .sort();
  for (const name of files) {
    const text = readFileSync(join(contentDir, name), "utf8");
    const extracted = extractFromText(text, name);
    for (const v of extracted.verbs) verbs.add(v);
    pairs.push(...extracted.pairs);
  }
  return { verbs: [...verbs].sort(), pairs };
}

/** User dialogue section per FLOW-1 (heading through line before the --- separator). */
export function extractUserDialogueSection(feedbackMd: string): string {
  const start = feedbackMd.indexOf("## User dialogue (say this to the human)");
  if (start < 0) {
    throw new Error("FLOW-1: missing ## User dialogue heading");
  }
  const agent = feedbackMd.indexOf("## Agent actions", start);
  if (agent < 0) {
    throw new Error("FLOW-1: missing ## Agent actions heading");
  }
  const before = feedbackMd.slice(start, agent);
  const stripped = before.replace(/\n---\n[\s\S]*$/, "");
  return `${stripped.replace(/\n+$/, "")}\n`;
}

/** Agent actions section of feedback.md (heading to EOF or next H1). */
export function extractAgentActionsSection(feedbackMd: string): string {
  const start = feedbackMd.indexOf("## Agent actions");
  if (start < 0) {
    throw new Error("FLOW-4: missing ## Agent actions heading");
  }
  return feedbackMd.slice(start);
}

/** Collection & Feedback section of canonical-tasks.md. */
export function extractCollectionFeedbackSection(tasksMd: string): string {
  const start = tasksMd.indexOf("## Collection & Feedback");
  if (start < 0) {
    throw new Error("FLOW-4: missing ## Collection & Feedback heading");
  }
  const next = tasksMd.indexOf("\n## ", start + 1);
  return next < 0 ? tasksMd.slice(start) : tasksMd.slice(start, next);
}

/** Phase 8 block from docs/manual-test-plan.md (stops before Pass criteria / next H2). */
export function extractPhase8(manualPlan: string): string {
  const start = manualPlan.indexOf("## Phase 8");
  if (start < 0) {
    throw new Error("FLOW-7: missing ## Phase 8 heading");
  }
  const from = manualPlan.slice(start);
  const pass = from.search(/\n### Pass criteria/);
  if (pass >= 0) return from.slice(0, pass);
  const next = from.indexOf("\n## ", 1);
  return next < 0 ? from : from.slice(0, next);
}

/** CHANGELOG [Unreleased] section body, or null if absent. */
export function extractUnreleased(changelog: string): string | null {
  const start = changelog.search(/^## \[Unreleased\]\s*$/m);
  if (start < 0) return null;
  const rest = changelog.slice(start);
  const next = rest.search(/\n## \[/);
  return next < 0 ? rest : rest.slice(0, next);
}

/** Match `--name` as a flag token, not as a substring of `--first-name` / `--last-name`. */
export function hasForbiddenNameFlag(text: string): boolean {
  return /(?<![\w-])--name(?![\w-])/.test(text);
}
