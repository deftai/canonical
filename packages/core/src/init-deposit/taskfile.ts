/**
 * Root Taskfile.yml wiring -- text-level insertion of the `canon:` include,
 * simplified port of the reference framework's init-deposit/scaffold.ts
 * `ensureTaskfile` (single "deft" include -> canon's, no legacy-migration
 * branches since this pack has no prior installer to migrate from).
 */

export const CANONICAL_TASKFILE_INCLUDE = "taskfile: ./.canonical/core/Taskfile.yml";

function canonIncludeChildBlock(childIndent: string): string {
  const field = `${childIndent}  `;
  return (
    `${childIndent}canon:\n` +
    `${field}taskfile: ./.canonical/core/Taskfile.yml\n` +
    `${field}optional: true\n` +
    `${field}flatten: true\n`
  );
}

export const MINIMAL_TASKFILE = `version: '3'\n\nincludes:\n${canonIncludeChildBlock("  ")}`;

function hasTopLevelIncludes(content: string): boolean {
  if (!content) {
    return false;
  }
  const norm = `\n${content.replace(/\r\n/g, "\n")}`;
  if (/\nincludes:/.test(norm)) {
    return true;
  }
  return content.trimStart().startsWith("includes:");
}

/**
 * Insert the canon child after a block-form `includes:` line, matching the
 * indentation of the existing children so we never re-parent the user's
 * includes. Inline-map form (`includes: {...}`) is NOT handled -- ok: false.
 */
function insertCanonIncludeAfterIncludesLine(content: string): { content: string; ok: boolean } {
  const norm = content.replace(/\r\n/g, "\n");
  const lines = norm.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (line.length === 0 || line[0] === " " || line[0] === "\t") {
      continue;
    }
    if (line.trimEnd() === "includes:") {
      // Match the first existing child's indentation; default two spaces.
      let childIndent = "  ";
      for (let j = i + 1; j < lines.length; j++) {
        const next = lines[j] ?? "";
        if (next.trim().length === 0) {
          continue;
        }
        const m = /^([ \t]+)\S/.exec(next);
        if (m?.[1] !== undefined) {
          childIndent = m[1];
        }
        break;
      }
      const out = [
        ...lines.slice(0, i + 1),
        ...canonIncludeChildBlock(childIndent).trimEnd().split("\n"),
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
  /** Set when the include could not be wired safely; caller must surface it. */
  readonly warning?: string;
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
    // Inline-map `includes: {...}` (or otherwise unparseable) -- appending a
    // second top-level `includes:` key would produce invalid YAML and break
    // every `task` invocation. Refuse and tell the operator what to add.
    return {
      content: existing,
      changed: false,
      warning:
        "Taskfile.yml has an `includes:` form this installer cannot safely edit -- add the canon include manually:\n" +
        `includes:\n${canonIncludeChildBlock("  ")}`,
    };
  }
  const sep = existing.endsWith("\n") ? "\n" : "\n\n";
  return {
    content: `${existing}${sep}includes:\n${canonIncludeChildBlock("  ")}`,
    changed: true,
  };
}
