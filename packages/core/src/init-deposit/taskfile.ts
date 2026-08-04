/**
 * Root Taskfile.yml wiring -- text-level insertion of the `canon:` include,
 * simplified port of the reference framework's init-deposit/scaffold.ts
 * `ensureTaskfile` (single "deft" include -> canon's, no legacy-migration
 * branches since this pack has no prior installer to migrate from).
 */

export const CANONICAL_TASKFILE_INCLUDE = "taskfile: ./.canonical/core/Taskfile.yml";

const CANON_INCLUDE_CHILD_BLOCK =
  "  canon:\n" +
  "    taskfile: ./.canonical/core/Taskfile.yml\n" +
  "    optional: true\n" +
  "    flatten: true\n";

export const MINIMAL_TASKFILE = `version: '3'\n\nincludes:\n${CANON_INCLUDE_CHILD_BLOCK}`;

function hasTopLevelIncludes(content: string): boolean {
  if (!content) {
    return false;
  }
  const norm = `\n${content.replace(/\r\n/g, "\n")}`;
  if (norm.includes("\nincludes:")) {
    return true;
  }
  return content.trimStart().startsWith("includes:");
}

function insertCanonIncludeAfterIncludesLine(content: string): { content: string; ok: boolean } {
  const norm = content.replace(/\r\n/g, "\n");
  const lines = norm.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (line.length === 0 || line[0] === " " || line[0] === "\t") {
      continue;
    }
    if (line.trimEnd() === "includes:") {
      const out = [
        ...lines.slice(0, i + 1),
        ...CANON_INCLUDE_CHILD_BLOCK.trimEnd().split("\n"),
        ...lines.slice(i + 1),
      ];
      return { content: out.join("\n"), ok: true };
    }
  }
  return { content, ok: false };
}

export interface TaskfileApplyResult {
  readonly content: string;
  readonly changed: boolean;
}

/** Compute the next root Taskfile.yml content. `existing` is `null` when absent. */
export function applyTaskfile(existing: string | null): TaskfileApplyResult {
  if (existing === null) {
    return { content: MINIMAL_TASKFILE, changed: true };
  }
  if (existing.includes(CANONICAL_TASKFILE_INCLUDE)) {
    return { content: existing, changed: false };
  }
  if (hasTopLevelIncludes(existing)) {
    const inserted = insertCanonIncludeAfterIncludesLine(existing);
    if (inserted.ok) {
      return { content: inserted.content, changed: true };
    }
  }
  const sep = existing.endsWith("\n") ? "\n" : "\n\n";
  return {
    content: `${existing}${sep}includes:\n${CANON_INCLUDE_CHILD_BLOCK}`,
    changed: true,
  };
}
