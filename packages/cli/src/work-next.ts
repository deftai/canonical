import { existsSync, statSync } from "node:fs";
import { parseArgs, renderJson } from "@canonpack/core/args";
import { workNext } from "@canonpack/core/work-next";

/** `work:next` handler. Contract: content/canonical-tasks.md. */

function emit(json: boolean, code: number, payload: Record<string, unknown>, text: string): number {
  if (json) {
    process.stdout.write(`${renderJson(payload)}\n`);
  } else if (code === 0) {
    process.stdout.write(text);
  } else {
    process.stderr.write(text);
  }
  return code;
}

export function run(argv: string[]): number {
  const parsed = parseArgs(argv, { valueFlags: ["project-root"], boolFlags: ["json"] });
  const json = parsed.flags.json === true;
  if (parsed.error !== undefined) {
    return emit(json, 2, { ok: false, error: parsed.error }, `canon: work-next: ${parsed.error}\n`);
  }

  const projectRoot = parsed.values["project-root"] ?? ".";
  if (!existsSync(projectRoot) || !statSync(projectRoot).isDirectory()) {
    const message = `project root not found: ${projectRoot}`;
    return emit(json, 2, { ok: false, error: message }, `canon: work-next: ${message}\n`);
  }

  const result = workNext(projectRoot);
  if (result.kind === "error") {
    return emit(
      json,
      2,
      { ok: false, error: result.message },
      `canon: work-next: ${result.message}\n`,
    );
  }
  if (result.kind === "empty") {
    return emit(json, 1, { ok: true, empty: true }, "canon: work-next: no work item available\n");
  }

  const item = result.item;
  return emit(
    json,
    0,
    { ok: true, path: item.relPath, title: item.title, status: item.status },
    `${item.relPath}\t${item.title}\n`,
  );
}
