/** `canon scope:start` -- content/canonical-tasks.md #scope:start. */
import { parseArgs, renderJson } from "../args/index.js";
import { scopeStartDimensions, softEmitUsage } from "../collection/index.js";
import { scopeStart } from "../scope/index.js";
import { findScope, readScope } from "../xbrief/brief-io.js";

export async function run(argv: string[]): Promise<number> {
  const parsed = parseArgs(argv, {
    valueFlags: ["project-root"],
    boolFlags: ["json", "check", "allow-dirty"],
    maxPositional: 1,
  });
  if (parsed.error !== undefined) {
    process.stderr.write(`canon: scope-start: ${parsed.error}\n`);
    return 2;
  }

  const scopeArg = parsed.positional[0];
  if (scopeArg === undefined) {
    process.stderr.write("canon: scope-start: missing scope argument\n");
    return 2;
  }

  const projectRoot = parsed.values["project-root"] ?? ".";
  const found = findScope(projectRoot, scopeArg);
  const scopeBefore = found !== null && !("ambiguous" in found) ? readScope(found.path) : undefined;
  const result = scopeStart(projectRoot, {
    scope: scopeArg,
    check: parsed.flags.check ?? false,
    allowDirty: parsed.flags["allow-dirty"] ?? false,
  });

  if (!result.ok) {
    process.stderr.write(`canon: scope-start: ${result.message}\n`);
    return result.code;
  }

  if (parsed.flags.json === true) {
    process.stdout.write(
      `${renderJson({
        ok: true,
        scope: result.scope,
        status: result.status,
        checked: result.checked ?? false,
      })}\n`,
    );
  } else {
    process.stdout.write(
      result.checked === true
        ? `${result.scope}: running (verified)\n`
        : `${result.scope}: running\n`,
    );
  }
  if (result.checked !== true && scopeBefore?.ok === true) {
    await softEmitUsage(
      projectRoot,
      "xbrief_scope_start",
      1,
      scopeStartDimensions(scopeBefore.scope),
    );
  }
  return 0;
}
