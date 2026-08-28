/** `canon collection:decline` -- record local decline without registering. */
import { parseArgs, renderJson } from "../args/index.js";
import { collectionDecline } from "../collection/index.js";

export function run(argv: string[]): number {
  const parsed = parseArgs(argv, {
    valueFlags: ["project-root"],
    boolFlags: ["json"],
    maxPositional: 0,
  });
  if (parsed.error !== undefined) {
    process.stderr.write(`canon: collection-decline: ${parsed.error}\n`);
    return 2;
  }

  const projectRoot = parsed.values["project-root"] ?? ".";
  const result = collectionDecline(projectRoot);

  if (parsed.flags.json === true) {
    process.stdout.write(`${renderJson({ code: result.code, message: result.message })}\n`);
  } else if (result.code === 0) {
    process.stdout.write(`${result.message}\n`);
  } else {
    process.stderr.write(`${result.message}\n`);
  }
  return result.code;
}
