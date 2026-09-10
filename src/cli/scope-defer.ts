/** `canon scope:defer` -- park an accepted scope (status approved, folder deferred/). */
import { parseArgs, renderJson } from "../args/index.js";
import { scopeStop } from "../scope/index.js";

export function run(argv: string[]): number {
  const parsed = parseArgs(argv, {
    valueFlags: ["project-root", "note"],
    boolFlags: ["json"],
    maxPositional: 1,
  });
  if (parsed.error !== undefined) {
    process.stderr.write(`canon: scope-defer: ${parsed.error}\n`);
    return 2;
  }

  const scopeArg = parsed.positional[0];
  if (scopeArg === undefined) {
    process.stderr.write("canon: scope-defer: missing scope argument\n");
    return 2;
  }

  const projectRoot = parsed.values["project-root"] ?? ".";
  const result = scopeStop(projectRoot, { scope: scopeArg, mode: "defer", note: parsed.values.note });

  if (!result.ok) {
    process.stderr.write(`canon: scope-defer: ${result.message}\n`);
    return result.code;
  }

  if (parsed.flags.json === true) {
    process.stdout.write(
      `${renderJson({ ok: true, scope: result.scope, status: result.status })}\n`,
    );
  } else {
    process.stdout.write(`${result.scope}: ${result.status}\n`);
  }
  return 0;
}
