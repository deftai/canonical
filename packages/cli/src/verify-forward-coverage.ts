import { parseArgs, renderJson } from "@canonpack/core/args";
import { evaluateForwardCoverage } from "@canonpack/core/forward-coverage";

/** `canon verify:forward-coverage` -- contract: content/canonical-tasks.md. */
export function run(argv: string[]): number {
  const parsed = parseArgs(argv, {
    valueFlags: ["project-root"],
    boolFlags: ["json", "staged"],
  });
  if (parsed.error !== undefined) {
    process.stderr.write(`canon: verify:forward-coverage -- ${parsed.error}\n`);
    return 2;
  }

  const projectRoot = parsed.values["project-root"] ?? ".";
  // Forward coverage is inherently a staged-index check (content/canonical-tasks.md:
  // "for each staged new source file"); --staged is accepted for CLI-convention
  // symmetry with verify:encoding but the evaluation always reads the index.
  const result = evaluateForwardCoverage(projectRoot);

  if (parsed.flags.json === true) {
    process.stdout.write(
      `${renderJson({ exit_code: result.code, missing_count: result.missing.length })}\n`,
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
