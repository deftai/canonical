import { parseArgs, renderJson } from "../args/index.js";
import { evaluateBranch } from "../branch/index.js";

/** `canon verify:branch` -- contract: content/canonical-tasks.md. */
export function run(argv: string[]): number {
  const parsed = parseArgs(argv, {
    valueFlags: ["project-root"],
    boolFlags: ["json"],
  });
  if (parsed.error !== undefined) {
    process.stderr.write(`canon: verify:branch -- ${parsed.error}\n`);
    return 2;
  }

  const projectRoot = parsed.values["project-root"] ?? ".";
  const result = evaluateBranch(projectRoot);

  if (parsed.flags.json === true) {
    process.stdout.write(
      `${renderJson({ exit_code: result.code, message: result.message, override: result.override })}\n`,
    );
    return result.code;
  }

  if (result.code === 0) {
    process.stdout.write(`${result.message}\n`);
  } else {
    process.stderr.write(`${result.message}\n`);
  }
  return result.code;
}
