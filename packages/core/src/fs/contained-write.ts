import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";

/**
 * Atomic, containment-checked file writes. Every product write goes through
 * here: the target must resolve inside `root`, and the write is temp+rename
 * so a crash never leaves a half-written file.
 */

export type ContainedWriteErrorCode = "ESCAPE" | "WRITE_FAILED";

export class ContainedWriteError extends Error {
  readonly code: ContainedWriteErrorCode;
  constructor(code: ContainedWriteErrorCode, message: string) {
    super(message);
    this.name = "ContainedWriteError";
    this.code = code;
  }
}

/** Throws ContainedWriteError(ESCAPE) when target resolves outside root. */
export function assertContained(root: string, target: string): string {
  const absRoot = resolve(root);
  const absTarget = resolve(absRoot, target);
  const rel = relative(absRoot, absTarget);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) {
    return absTarget;
  }
  throw new ContainedWriteError("ESCAPE", `write target escapes project root: ${target}`);
}

export function atomicWriteText(root: string, target: string, text: string): string {
  const abs = assertContained(root, target);
  mkdirSync(dirname(abs), { recursive: true });
  const tmp = `${abs}.tmp-${process.pid}-${Math.floor(Math.random() * 1e9)}`;
  try {
    writeFileSync(tmp, text, "utf8");
    renameSync(tmp, abs);
  } catch (err) {
    throw new ContainedWriteError(
      "WRITE_FAILED",
      `write failed for ${target}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return abs;
}

/** Canonical JSON serialization for briefs: 2-space pretty + trailing newline. */
export function formatJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function atomicWriteJson(root: string, target: string, value: unknown): string {
  return atomicWriteText(root, target, formatJson(value));
}
