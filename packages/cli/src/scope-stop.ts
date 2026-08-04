/** `canon scope:stop` -- content/canonical-tasks.md #scope:stop. */
import { parseArgs, renderJson } from "@canonpack/core/args";
import { type StopMode, scopeStop } from "@canonpack/core/scope";

const MODE_FLAGS: readonly StopMode[] = ["cancel", "fail", "block", "unblock", "demote"];

export function run(argv: string[]): number {
  const parsed = parseArgs(argv, {
    valueFlags: ["project-root", "note"],
    boolFlags: ["json", "cancel", "fail", "block", "unblock", "demote"],
    maxPositional: 1,
  });
  if (parsed.error !== undefined) {
    process.stderr.write(`canon: scope-stop: ${parsed.error}\n`);
    return 2;
  }

  const activeModes = MODE_FLAGS.filter((m) => parsed.flags[m] === true);
  if (activeModes.length !== 1) {
    process.stderr.write(
      "canon: scope-stop: specify exactly one of --cancel|--fail|--block|--unblock|--demote\n",
    );
    return 2;
  }
  const mode = activeModes[0];
  if (mode === undefined) {
    process.stderr.write(
      "canon: scope-stop: specify exactly one of --cancel|--fail|--block|--unblock|--demote\n",
    );
    return 2;
  }

  const scopeArg = parsed.positional[0];
  if (scopeArg === undefined) {
    process.stderr.write("canon: scope-stop: missing scope argument\n");
    return 2;
  }

  const projectRoot = parsed.values["project-root"] ?? ".";
  const result = scopeStop(projectRoot, { scope: scopeArg, mode, note: parsed.values.note });

  if (!result.ok) {
    process.stderr.write(`canon: scope-stop: ${result.message}\n`);
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
