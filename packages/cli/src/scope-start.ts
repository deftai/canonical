/** `canon scope:start` -- content/canonical-tasks.md #scope:start. */
import { parseArgs, renderJson } from "@canonpack/core/args";
import { scopeStart } from "@canonpack/core/scope";

export function run(argv: string[]): number {
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
  return 0;
}
