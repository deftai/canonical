import { existsSync, statSync } from "node:fs";
import { parseArgs, renderJson } from "../args/index.js";
import {
  buildScopeSkeleton,
  findScopeFilenameCollision,
  scopeSkeletonFilename,
  writeScope,
} from "../xbrief/index.js";

/** `scope:new` handler. Contract: content/canonical-tasks.md. */

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
  const parsed = parseArgs(argv, {
    valueFlags: ["project-root"],
    boolFlags: ["json"],
    maxPositional: 1,
  });
  const json = parsed.flags.json === true;
  if (parsed.error !== undefined) {
    return emit(json, 2, { ok: false, error: parsed.error }, `canon: scope-new: ${parsed.error}\n`);
  }

  const title = parsed.positional[0];
  if (title === undefined || title.trim().length === 0) {
    const message = "missing required <title> argument";
    return emit(json, 2, { ok: false, error: message }, `canon: scope-new: ${message}\n`);
  }

  const projectRoot = parsed.values["project-root"] ?? ".";
  if (!existsSync(projectRoot) || !statSync(projectRoot).isDirectory()) {
    const message = `project root not found: ${projectRoot}`;
    return emit(json, 2, { ok: false, error: message }, `canon: scope-new: ${message}\n`);
  }

  const now = new Date();
  const filename = scopeSkeletonFilename(title, now);
  // A title of pure punctuation normalizes to an empty slug, which would write
  // a filename that violates the filename contract -- usage error, not a write.
  if (/^\d{4}-\d{2}-\d{2}-\.json$/.test(filename)) {
    const message = `title '${title}' normalizes to an empty slug -- use a title with letters or digits`;
    return emit(json, 2, { ok: false, error: message }, `canon: scope-new: ${message}\n`);
  }
  const relPath = `xbrief/proposed/${filename}`;

  const collision = findScopeFilenameCollision(projectRoot, filename);
  if (collision !== null) {
    return emit(
      json,
      1,
      { ok: false, code: "slug-collision", existing_path: collision.relPath },
      `canon: scope-new: slug collision, existing scope: ${collision.relPath}\n`,
    );
  }

  const skeleton = buildScopeSkeleton(title, now);
  writeScope(projectRoot, relPath, skeleton);

  return emit(
    json,
    0,
    { ok: true, path: relPath, title, status: skeleton.plan.status },
    `${relPath}\n`,
  );
}
