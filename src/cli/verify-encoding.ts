import { parseArgs, renderJson } from "../args/index.js";
import { evaluateEncoding } from "../encoding/index.js";

/** `canon verify:encoding` -- contract: content/canonical-tasks.md. */
export function run(argv: string[]): number {
  const parsed = parseArgs(argv, {
    valueFlags: ["project-root"],
    boolFlags: ["json", "staged"],
  });
  if (parsed.error !== undefined) {
    process.stderr.write(`canon: verify:encoding -- ${parsed.error}\n`);
    return 2;
  }

  const projectRoot = parsed.values["project-root"] ?? ".";
  const result = evaluateEncoding(projectRoot, { staged: parsed.flags.staged === true });

  if (parsed.flags.json === true) {
    process.stdout.write(
      `${renderJson({ exit_code: result.code, finding_count: result.findings.length })}\n`,
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
